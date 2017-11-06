extern crate iron;
extern crate params;
extern crate rand;
extern crate router;

use iron::prelude::*;
use iron::status;
use params::Params;

fn handle(req: &mut Request) -> IronResult<Response> {
    let params = req.get_ref::<Params>();
    if params.is_err() {
        return Ok(Response::with((status::BadRequest, "'not a form post'")));
    }

    unimplemented!()
}

fn main() {
    let mut router = router::Router::new();
    router.post("/", handle, "root");
    Iron::new(router).http("127.0.0.1:9696").unwrap();
}
