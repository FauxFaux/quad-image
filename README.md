# quad-image

[![](https://img.shields.io/crates/v/quad-image.svg)](https://crates.io/crates/quad-image)

A very, very simple image hosting API, plus support files.

 * You send it an image.
 * The image is decoded and re-encoded using
[image-rs](https://crates.io/crates/image).
 * The image is saved to the local disc.
 * The URL of the image is returned.

Feature creep:

 * Image thumbnails are produced
 * Users can append images to galleries (if they know the secret),
    and list images in the gallery (if they know the less secret)
 * There's also a UI.

### Building

`quad-image` probably only works on libc/Unix operating systems.
It requires Rust, stable should be fine.

Build it by running `cargo build --release`, and grabbing the binary from
`target/release/quad-image`.


### Hosting

The expected deployment situation is:

 * `quad-image` running under a service manager.
 * the `web/` subdirectory being served by a webserver
 * the webserver proxying traffic to `quad-image`.

There are example config files in `quad-image.nginx` (for nginx) and
`quad-image.service` (for systemd). All the ports/addresses are hardcoded.

---

A [`Dockerfile`](Dockerfile) is provided, if you prefer that kind of thing.
It performs an isolated build and provides a minimal `alpine`-based container.
It is not CI'd or published.

You could run it like this, if you trusted Docker's to manage your data storage,
which I wouldn't recommend:
```
docker run --name quad-image -p 6600:80 -it $(docker build -q .)
```

### Safety

HTTP is handled by [Axum](https://crates.io/crates/axum), a modern
Rust HTTP library. It's expected that you will run the API server
behind `nginx`, so it doesn't even have to cope with TLS or any HTTP
weirdness.

Users have no control over the target filename. They cannot plausibly
overwrite files on the server, or generate URLs of their choosing.

Images are decoded and re-encoded using `image-rs` before writing
to the filesystem, there should be no way to get non-image data served.
That is, all files that make it to the filesystem are valid, minimal
images with no extra information in, either in metadata or elsewhere
in the file.

This protects against:

 * users uploading images with their GPS location in metadata
 * serving exploits for other image libraries
 * distributing payloads that aren't part of the image
 * misconfigured webservers attempting to execute uploaded files as PHP

`image-rs` is a Rusty library which probably doesn't have all the
memory corruption bugs that `libpng`, `libjpeg`, etc. have, and
almost certainly doesn't have all the insane failure modes that
imagemagick's `convert` has.
