extern crate iron;
extern crate params;
extern crate rand;
extern crate router;
extern crate tempfile;

use std::fs;
use std::io;
use std::io::BufRead;
use std::io::Seek;
use std::io::SeekFrom;

use iron::prelude::*;
use iron::status;
use params::Params;

use rand::Rng;

const C_OPEN_FAILED_ALREADY_EXISTS: i32 = 17;

fn store(f: &params::File) -> io::Result<String> {
    unimplemented!()
}

fn upload(req: &mut Request) -> IronResult<Response> {
    let params = req.get_ref::<Params>();
    if params.is_err() {
        return Ok(Response::with((status::BadRequest, "'not a form post'")));
    }

    unimplemented!()
}

fn main() {
    let mut router = router::Router::new();
    router.post("/api/upload", upload, "upload");
    Iron::new(router).http("127.0.0.1:6699").unwrap();
}
