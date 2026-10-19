# quad-image

[![](https://img.shields.io/crates/v/quad-image.svg)](https://crates.io/crates/quad-image)

A very, very simple image hosting API, plus support files.

 * You send it an image.
 * The image is decoded using [image-rs](https://crates.io/crates/image).
   Still images are re-encoded as WebP using the server's sandboxed encoder.
 * The image is saved to the local disc.
 * The URL of the image is returned.

Feature creep:

 * Image thumbnails are produced
 * Users can append images to galleries (if they know the secret),
    and list images in the gallery (if they know the less secret)
 * There's also a UI.

Append `?variant=thumbnail` to an image URL to fetch its still WebP thumbnail
directly, without a redirect. Clients can derive this URL from stored original
image URLs; the thumbnail's storage path, dimensions, and encoding settings
are server-controlled. The legacy `.thumb.jpg` URLs continue to serve JPEG.
The nginx fragment expects the standard `mime.types` table to be included so
that `.webp` files are served with `Content-Type: image/webp`.

Still uploads try **nl100, nl40, q90, q70** in parallel, followed by
**q50, q35, q20, q5** only when all first-pass results exceed 2 MB. Selection
prefers lossless/near-lossless and then higher lossy quality below 1 MB;
otherwise it keeps the smallest output. Animated GIF handling is unchanged.
See [the upload encoding policy](docs/upload-encoding.md) for exact byte
thresholds, concurrency, resource limits, and failure behavior.

### Streaming uploads

`POST /api/upload-stream` accepts multipart `image` and optional `gallery` fields,
using the same validation and storage pipeline as `/api/upload`. After parsing
and validating the form, it responds with HTTP 200 and `text/event-stream`:

```text
event: status
data: {"kind":"accepted","message":"Upload accepted, going to transcode"}

event: status
data: {"kind":"thumbnail","id":"e/abcdefghij.webp"}

event: done
data: {"data":{"id":"e/abcdefghij.webp","type":"image"}}

```

For still images, the `thumbnail` status announces that
`/{id}?variant=thumbnail` is ready while the full image is being encoded. The
full image may still fail; wait for `done` before treating the upload as complete.
Completion means the image, thumbnails, and optional gallery entry are ready.
Processing failures produce a terminal `error` event with a JSON `message`;
form validation failures return an HTTP error before streaming starts. The stream
closes after its terminal event. Keep-alive comments may appear during processing.
The streaming endpoint always returns image IDs; the legacy `return_json`,
`return_redirect`, and `return_full_url` options apply to `/api/upload` only.

To inspect events as they arrive:

```sh
curl -N -F image=@picture.png http://127.0.0.1:6699/api/upload-stream
```

The web client uses XMLHttpRequest upload progress events to report transfer
progress, then reads SSE events incrementally from `responseText` during response
progress events. Processing messages appear in the upload's state and tile.

### Building

`quad-image` probably only works on libc/Unix operating systems.
It requires Rust, stable should be fine.

Build it by running `cargo build --release`, and grabbing the binary from
`target/release/quad-image`.

The UI also needs to be built, by running `npm ci` and `npm run build`,
this converts the source in `web/` to the static files in `dist/`.


### Hosting

The expected deployment situation is:

 * `quad-image` running under a service manager,
     in a directory where it can write its database and `e` images directory
 * a webserver handling tls and proxying traffic to `quad-image`,
 * optionally, the webserver serving `dist/` (the compiled UI) over /.

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

Images are decoded using `image-rs` and re-encoded by the server before writing
to the filesystem. Still-image WebP encoding runs inside disposable Wasmtime
sandboxes with memory and execution limits; GIFs use the GIF decode/re-encode
path. There should be no way to get non-image data served.
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
