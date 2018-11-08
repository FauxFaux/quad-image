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

    store(include_bytes!("test.png")).unwrap();
    store(include_bytes!("../tests/parrot.gif")).unwrap();

    let mut now_extensions = fs::read_dir(&e)
        .unwrap()
        .map(|e| {
            e.unwrap()
                .path()
                .extension()
                .unwrap()
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<String>>();

    now_extensions.sort();

    assert_eq!(
        &["gif", "png"],
        now_extensions.as_slice(),
        "created one of each"
    );
}
