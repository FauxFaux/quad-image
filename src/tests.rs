use std::env;
use std::fs;
use std::io::Write;

use params;
use tempdir;

use store;

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

    {
        fs::File::create(&input).unwrap().write_all(bytes).unwrap();
    }

    store(&params::File {
        path: input,
        filename: None,
        size: bytes.len() as u64,
        content_type: "image/png".parse().unwrap(),
    }).unwrap();

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
