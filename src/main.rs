extern crate iron;
extern crate params;

use iron::prelude::*;
use params::Params;

fn handle(req: &mut Request) -> IronResult<Response> {
    req.get_ref::<Params>();
    unimplemented!()
}

fn main() {
    Iron::new(handle).http("127.0.0.1:9696").unwrap();
}
