use std::convert::TryInto;
use std::sync::{Arc, Mutex};

use anyhow::anyhow;
use anyhow::bail;
use anyhow::Error;
use base64::Engine;
use rusqlite::types::ToSql;
use rusqlite::Connection;

pub fn migrate_gallery(conn: &Connection) -> anyhow::Result<()> {
    conn.execute(
        "create table if not exists gallery_images (
gallery char(10) not null,
image char(15) not null,
added datetime not null
)",
        [],
    )?;
    conn.execute(
        "create unique index if not exists gal_img
on gallery_images (gallery, image)",
        [],
    )?;
    Ok(())
}

pub fn gallery_list_all(conn: &Connection, public: &str) -> Result<Vec<String>, Error> {
    let mut stat = conn.prepare(
        "select image from gallery_images
where gallery=? order by added desc",
    )?;

    let mut resp = Vec::new();

    for image in stat.query_map([public], |row| row.get::<usize, String>(0))? {
        resp.push(image?);
    }

    Ok(resp)
}

pub fn gallery_store(
    conn: &Arc<Mutex<Connection>>,
    global_secret: &[u8],
    gallery: &str,
    private: &str,
    images: &[&str],
) -> Result<String, Error> {
    let public = public_id_for(global_secret, gallery, private);

    let conn = conn.lock().map_err(|_| anyhow!("poison"))?;
    let mut stat =
        conn.prepare("insert into gallery_images (gallery, image, added) values (?, ?, ?)")?;

    let mut timestamp = epoch_millis();

    for image in images {
        match stat.execute([&public.as_str() as &dyn ToSql, &image, &timestamp]) {
            Ok(_) => timestamp += 1,
            Err(rusqlite::Error::SqliteFailure(ffi, _))
                if rusqlite::ErrorCode::ConstraintViolation == ffi.code =>
            {
                continue;
            }
            Err(e) => bail!(e),
        }
    }

    Ok(public)
}

fn public_id_for(global_secret: &[u8], gallery: &str, private: &str) -> String {
    let user_details = mac(gallery.as_bytes(), private.as_bytes());
    let masked = mac(global_secret, &user_details);
    let public = format!(
        "{}:{}",
        gallery,
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&masked[..7]),
    );
    public
}

fn mac(key: &[u8], val: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha512_256>::new_from_slice(key).expect("invalid key len");
    mac.update(val);
    mac.finalize().into_bytes().to_vec()
}

fn epoch_millis() -> i64 {
    use std::time;
    let start = time::SystemTime::now();
    let since_the_epoch = start
        .duration_since(time::UNIX_EPOCH)
        .unwrap_or_else(|_| time::Duration::new(0, 0));
    (since_the_epoch.as_secs() * 1000 + u64::from(since_the_epoch.subsec_nanos()) / 1_000_000)
        .try_into()
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::Mutex;

    use anyhow::Result;

    #[test]
    fn mem_db() -> Result<()> {
        let mut conn = rusqlite::Connection::open_in_memory()?;
        super::migrate_gallery(&mut conn)?;
        let wrapped = Arc::new(Mutex::new(conn));
        let public = super::gallery_store(
            &wrapped.clone(),
            &[1],
            "foo",
            "bar",
            &["e/img.jpg", "e/two.jpg"],
        )?;
        assert_eq!(
            vec!["e/two.jpg", "e/img.jpg"],
            super::gallery_list_all(&mut wrapped.lock().unwrap(), &public)?
        );
        Ok(())
    }

    #[test]
    fn maccies() {
        use super::mac;
        assert_eq!(
            &[
                69, 81, 173, 148, 113, 165, 126, 52, 75, 48, 237, 138, 72, 157, 60, 106, 202, 216,
                180, 255, 254, 145, 123, 127, 3, 4, 127, 36, 18, 57, 21, 51
            ],
            mac(&[1, 2, 3, 4], &[5, 6]).as_slice()
        );
    }

    #[test]
    fn public_id() {
        use super::public_id_for;
        assert_eq!(
            "potato:GTc-2ixSLg",
            public_id_for(&[5, 6], "potato", "carrots")
        );
    }
}
