### What's this?

This is a binary; a build of an AGPL library, https://github.com/kornelski/dssim,
committed to this repo for packaging reasons.

It is still AGPL-3.0.


### How?

The result of running:
```
RUSTFLAGS= wasm-pack build --release --no-default-features
```

on https://github.com/kornelski/dssim/tree/f3e2191efed786081f780ddea08a1e6027f31680/dssim-core,

which forces you to:

```diff
diff --git a/dssim-core/Cargo.toml b/dssim-core/Cargo.toml
index 3e9854a..330187f 100644
--- a/dssim-core/Cargo.toml
+++ b/dssim-core/Cargo.toml
@@ -14,13 +14,14 @@ version = "3.2.8"
 edition = "2021"
 
 [lib]
-crate-type = ["lib", "staticlib"]
+crate-type = ["cdylib"]
 
 [dependencies]
 imgref = "1.10.0"
 itertools = "0.12.0"
 rayon = { version = "1.8.1", optional = true }
 rgb = "0.8.37"
+wasm-bindgen = "0.2.92"
 
 [dev-dependencies]
 lodepng = "3.10.0"
@@ -51,3 +52,5 @@ generation = false
 
 [package.metadata.capi.install.include]
 asset = [{from = "dssim.h"}]
```

And, because I do not understand wasm at all:
```diff
--- a/dssim-core/src/c_api.rs
+++ b/dssim-core/src/c_api.rs
@@ -70,3 +70,12 @@ pub unsafe extern "C" fn dssim_free_image(img: *mut DssimImage) {
     val.into()
 }
 
+#[no_mangle] pub unsafe extern fn dssim_calloc(n: usize) -> *mut u8 {
+    let v = vec![0u8; n];
+    let v = v.into_boxed_slice();
+    Box::leak(v).as_mut_ptr()
+}
+
+#[no_mangle] pub unsafe extern fn dssim_free_calloc(ptr: *mut u8, n: usize) {
+    let _ = Box::from_raw(std::slice::from_raw_parts_mut(ptr, n));
+}
```

### License

This library is AGPL-3.0 licensed.
The original repository, and source, is at https://github.com/kornelski/dssim.
