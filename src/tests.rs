use std::env;
use std::fs;

use tempdir;

use crate::ingest::store;

#[test]
fn write_an_image() {
    // TODO: race central
    let d = tempdir::TempDir::new("quad-image").unwrap();
    env::set_current_dir(d.path()).unwrap();

    let mut e = d.path().to_path_buf();
    e.push("e");
    fs::create_dir(&e).unwrap();

    let mut input = d.path().to_path_buf();
    input.push("test.png");

    let bytes = include_bytes!("test.png");

    store(bytes).unwrap();

    assert_eq!(
        &["png"],
        fs::read_dir(&e)
            .unwrap()
            .map(|e| e
                .unwrap()
                .path()
                .extension()
                .unwrap()
                .to_string_lossy()
                .to_string())
            .collect::<Vec<String>>()
            .as_slice(),
        "created exactly one png file"
    );
}
