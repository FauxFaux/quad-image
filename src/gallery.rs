use base64;
use cast::i64;
use failure::Error;
use hmac;
use rusqlite;
use rusqlite::types::ToSql;
use rusqlite::Connection;
use sha2;

fn gallery_db() -> Result<Connection, Error> {
    Ok(Connection::open("gallery.db")?)
}

pub fn migrate_gallery() -> Result<(), Error> {
    let conn = gallery_db()?;
    conn.execute(
        "create table if not exists gallery_images (
gallery char(10) not null,
image char(15) not null,
added datetime not null
)",
        rusqlite::NO_PARAMS,
    )?;
    conn.execute(
        "create unique index if not exists gal_img
on gallery_images (gallery, image)",
        rusqlite::NO_PARAMS,
    )?;
    Ok(())
}

pub fn gallery_list_all(public: &str) -> Result<Vec<String>, Error> {
    let conn = gallery_db()?;

    let mut stat = conn.prepare(
        "select image from gallery_images
where gallery=? order by added desc",
    )?;

    let mut resp = Vec::new();

    for image in stat.query_map(&[&public], |row| row.get::<usize, String>(0))? {
        resp.push(image?);
    }

    Ok(resp)
}

pub fn gallery_store(
    global_secret: &[u8],
    gallery: &str,
    private: &str,
    images: &[&str],
) -> Result<String, Error> {
    let user_details = mac(gallery.as_bytes(), private.as_bytes());
    let masked = mac(global_secret, &user_details);
    let public = format!(
        "{}:{}",
        gallery,
        base64::encode_config(&masked[..7], base64::URL_SAFE_NO_PAD)
    );

    let db = gallery_db()?;
    let mut stat =
        db.prepare("insert into gallery_images (gallery, image, added) values (?, ?, ?)")?;

    let mut timestamp = epoch_millis();

    for image in images {
        match stat.execute(&[&public.as_str() as &ToSql, &image, &timestamp]) {
            Ok(_) => timestamp += 1,
            Err(rusqlite::Error::SqliteFailure(ffi, _))
                if rusqlite::ErrorCode::ConstraintViolation == ffi.code =>
            {
                continue
            }
            Err(e) => bail!(e),
        }
    }

    Ok(public)
}

fn mac(key: &[u8], val: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha512Trunc256>::new_varkey(key).expect("varkey");
    mac.input(val);
    mac.result().code().to_vec()
}

fn epoch_millis() -> i64 {
    use std::time;
    let start = time::SystemTime::now();
    let since_the_epoch = start
        .duration_since(time::UNIX_EPOCH)
        .unwrap_or_else(|_| time::Duration::new(0, 0));
    i64(since_the_epoch.as_secs() * 1000 + since_the_epoch.subsec_nanos() as u64 / 1_000_000)
        .unwrap_or(std::i64::MAX)
}
