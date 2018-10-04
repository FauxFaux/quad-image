use failure::Error;
use rusqlite::Connection;

fn gallery_db() -> Result<Connection, Error> {
    Ok(Connection::open("gallery.db")?)
}

pub fn migrate_gallery() -> Result<(), Error> {
    let conn = gallery_db()?;
    conn.execute(
        "create table if not exists gallery_images (
gallery char(10) not null,
image char(10) not null,
added datetime not null
)",
        &[],
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
    secret: &[u8],
    token: &str,
    private: &str,
    image: &str,
) -> Result<String, Error> {
    let user_details = mac(token.as_bytes(), private.as_bytes());
    let trigger = mac(secret, &user_details);
    let public = format!(
        "{}:{}",
        token,
        base64::encode_config(&trigger[..7], base64::URL_SAFE_NO_PAD)
    );

    gallery_db()?.execute(
        "insert into gallery_images (gallery, image, added) values (?, ?, current_timestamp)",
        &[&public, &image],
    )?;

    Ok(public)
}

fn mac(key: &[u8], val: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha512Trunc256>::new_varkey(key).expect("varkey");
    mac.input(val);
    mac.result().code().to_vec()
}
