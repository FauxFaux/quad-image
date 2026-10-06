use super::*;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use wasmtime::{Instance, Trap};

fn guest(wat: &str, limits: Limits) -> Result<Vec<u8>> {
    let wasm = wat::parse_str(wat)?;
    guest_module(&compile(&wasm)?, limits)
}

fn guest_module(module: &Module, limits: Limits) -> Result<Vec<u8>> {
    run(limits, module, |store, module| {
        let instance = Instance::new(&mut *store, module, &[])?;
        instance
            .get_typed_func::<(), ()>(&mut *store, "run")?
            .call(store, ())?;
        Ok(Vec::new())
    })
}

#[test]
fn embedded_encoder_produces_decodable_lossy_webp() -> Result<()> {
    let compiled = compiled_encoder()?;
    let image = image::load_from_memory(include_bytes!("../../tests/orient.webp"))?.to_rgba8();
    let (width, height) = image.dimensions();
    // Different calls each get a new store and thread; returned bytes remain
    // usable after the corresponding guest memory has been destroyed.
    let first = encode_rgba(image.as_raw(), width, height, 75.0, Limits::default())?;
    let second = encode_rgba(image.as_raw(), width, height, 75.0, Limits::default())?;
    assert!(std::ptr::eq(compiled, compiled_encoder()?));
    assert_eq!(first, second);
    assert_eq!(&first[..4], b"RIFF");
    assert_eq!(&first[8..12], b"WEBP");
    assert!(first.windows(4).any(|chunk| chunk == b"VP8 "));
    let decoded = image::load_from_memory(&first)?.to_rgba8();
    assert_eq!(decoded.dimensions(), (width, height));
    Ok(())
}

#[test]
fn alpha_quality_reduces_size_and_preserves_transparency_endpoints() -> Result<()> {
    let mut state = 1_u32;
    let pixels = image::RgbaImage::from_fn(128, 128, |_, _| {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        image::Rgba([80, 120, 160, state as u8])
    });
    let lossless_alpha = encode_rgba(pixels.as_raw(), 128, 128, 30.0, Limits::default())?;
    let reduced_alpha =
        encode_rgba_with_alpha_quality(pixels.as_raw(), 128, 128, 30.0, 30, Limits::default())?;
    assert!(reduced_alpha.len() < lossless_alpha.len());
    let original = image::load_from_memory(&lossless_alpha)?.into_rgba8();
    let reduced = image::load_from_memory(&reduced_alpha)?.into_rgba8();
    assert_eq!(reduced.dimensions(), pixels.dimensions());
    let mut changed = false;
    for ((source, original), reduced) in
        pixels.pixels().zip(original.pixels()).zip(reduced.pixels())
    {
        assert_eq!(source[3], original[3]);
        if source[3] == 0 || source[3] == 255 {
            assert_eq!(source[3], reduced[3]);
        }
        changed |= source[3] != reduced[3];
    }
    assert!(changed, "low alpha quality should quantize translucency");
    assert!(encode_rgba_with_alpha_quality(
        pixels.as_raw(),
        128,
        128,
        30.0,
        101,
        Limits::default(),
    )
    .is_err());
    Ok(())
}

#[test]
fn alpha_quality_does_not_change_opaque_images() -> Result<()> {
    let pixels = image::load_from_memory(include_bytes!("../../tests/orient.png"))?.into_rgba8();
    let original = encode_rgba(
        pixels.as_raw(),
        pixels.width(),
        pixels.height(),
        30.0,
        Limits::default(),
    )?;
    let reduced = encode_rgba_with_alpha_quality(
        pixels.as_raw(),
        pixels.width(),
        pixels.height(),
        30.0,
        30,
        Limits::default(),
    )?;
    assert_eq!(original, reduced);
    Ok(())
}

#[test]
fn rejects_invalid_input_before_starting_guest() {
    let limits = Limits::default();
    for (pixels, width, height, quality) in [
        (&[0; 4][..], 0, 1, 75.0),
        (&[0; 4][..], 1, 16384, 75.0),
        (&[0; 3][..], 1, 1, 75.0),
        (&[0; 4][..], 1, 1, f32::NAN),
        (&[0; 4][..], 1, 1, f32::INFINITY),
        (&[0; 4][..], 1, 1, -1.0),
        (&[0; 4][..], 1, 1, 101.0),
    ] {
        assert!(encode_rgba(pixels, width, height, quality, limits).is_err());
    }
    for limits in [
        Limits {
            memory_bytes: 0,
            ..limits
        },
        Limits {
            timeout: Duration::ZERO,
            ..limits
        },
        Limits {
            timeout: Duration::MAX,
            ..limits
        },
    ] {
        assert!(guest("(module)", limits).is_err());
    }
}

#[test]
fn rejects_initial_memory_above_limit() {
    let error = guest(
        "(module (memory 2) (func (export \"run\")))",
        Limits {
            memory_bytes: 65536,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("memory"));
}

#[test]
fn traps_on_memory_growth_above_limit() {
    let error = guest(
        "(module (memory 1) (func (export \"run\") i32.const 1 memory.grow drop))",
        Limits {
            memory_bytes: 65536,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("memory"));
    // A subsequent invocation has an independent memory budget.
    guest(
        "(module (memory 1) (func (export \"run\") i32.const 1 memory.grow drop))",
        Limits {
            memory_bytes: 2 * 65536,
            ..Limits::default()
        },
    )
    .unwrap();
}

#[test]
fn real_encoder_cannot_exceed_memory_budget() -> Result<()> {
    // Use the artifact's actual initial size, so this tests allocation failure
    // during encoding rather than failing at instantiation.
    let engine = Engine::default();
    let module = Module::new(&engine, ENCODER)?;
    let memory = module
        .exports()
        .find_map(|export| export.ty().memory().cloned())
        .unwrap();
    let initial = memory.minimum() as usize * 65536;
    let rgba = vec![255; 2048 * 2048 * 4];
    let error = encode_rgba(
        &rgba,
        2048,
        2048,
        75.0,
        Limits {
            memory_bytes: initial.max(rgba.len()),
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("memory"));
    Ok(())
}

#[test]
fn epoch_timeout_interrupts_infinite_guest_loop() {
    let start = Instant::now();
    let error = guest(
        "(module (func (export \"run\") (loop br 0)))",
        Limits {
            timeout: Duration::from_millis(1),
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.downcast_ref::<Trap>(), Some(&Trap::Interrupt));
    assert!(start.elapsed() >= EPOCH_INTERVAL);
    assert!(start.elapsed() < Duration::from_secs(10));
}

#[test]
fn epoch_timeout_also_covers_module_start() {
    let error = guest(
        "(module (func $start (loop br 0)) (start $start) (func (export \"run\")))",
        Limits {
            timeout: Duration::from_secs(1),
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.downcast_ref::<Trap>(), Some(&Trap::Interrupt));
}

struct ThreadExited(Arc<AtomicBool>);

impl Drop for ThreadExited {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

thread_local! {
    static ON_EXIT: RefCell<Option<ThreadExited>> = const { RefCell::new(None) };
}

#[test]
fn worker_is_joined_on_success_error_and_panic() {
    let module = compile(&wat::parse_str("(module)").unwrap()).unwrap();
    for outcome in 0..3 {
        let exited = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&exited);
        let result = run(Limits::default(), &module, move |_, _| {
            ON_EXIT.with(|slot| *slot.borrow_mut() = Some(ThreadExited(flag)));
            assert_eq!(thread::current().name(), Some("webp-encoder"));
            match outcome {
                0 => Ok(vec![1]),
                1 => bail!("deliberate failure"),
                _ => panic!("deliberate worker panic"),
            }
        });
        assert_eq!(result.is_ok(), outcome == 0);
        assert!(
            exited.load(Ordering::SeqCst),
            "worker must exit before returning"
        );
    }
}

#[test]
fn concurrent_timeouts_have_independent_epochs() {
    let module =
        compile(&wat::parse_str("(module (func (export \"run\") (loop br 0)))").unwrap()).unwrap();
    thread::scope(|scope| {
        let short = scope.spawn(|| {
            guest_module(
                &module,
                Limits {
                    timeout: Duration::from_secs(1),
                    ..Limits::default()
                },
            )
        });
        let start = Instant::now();
        let long = guest_module(
            &module,
            Limits {
                timeout: Duration::from_secs(2),
                ..Limits::default()
            },
        )
        .unwrap_err();
        assert_eq!(long.downcast_ref::<Trap>(), Some(&Trap::Interrupt));
        assert!(start.elapsed() >= Duration::from_secs(2));
        assert!(short.join().unwrap().is_err());
    });
}

#[test]
fn shared_module_does_not_share_guest_memory_globals_or_tables() -> Result<()> {
    let module = compile(&wat::parse_str(
        r#"(module
            (memory 1)
            (global $state (mut i32) (i32.const 0))
            (table 1 funcref)
            (func $seed)
            (elem declare func $seed)
            (func (export "clean") (result i32)
                i32.const 0 i32.load i32.eqz
                global.get $state i32.eqz i32.and
                i32.const 0 table.get 0 ref.is_null i32.and)
            (func (export "dirty")
                i32.const 0 i32.const 123 i32.store
                i32.const 456 global.set $state
                i32.const 0 ref.func $seed table.set 0)
            (func (export "trap") unreachable)
            (func (export "timeout") (loop br 0)))"#,
    )?)?;
    let invocation = |outcome| {
        run(
            Limits {
                timeout: Duration::from_secs(1),
                ..Limits::default()
            },
            &module,
            |store, module| {
                let instance = Instance::new(&mut *store, module, &[])?;
                let clean = instance.get_typed_func::<(), u32>(&mut *store, "clean")?;
                assert_eq!(clean.call(&mut *store, ())?, 1);
                instance
                    .get_typed_func::<(), ()>(&mut *store, "dirty")?
                    .call(&mut *store, ())?;
                assert_eq!(clean.call(&mut *store, ())?, 0);
                if let Some(export) = outcome {
                    instance
                        .get_typed_func::<(), ()>(&mut *store, export)?
                        .call(store, ())?;
                }
                Ok(Vec::new())
            },
        )
    };
    invocation(None)?;
    assert!(invocation(Some("trap")).is_err());
    assert!(invocation(Some("timeout")).is_err());
    invocation(None)?;
    thread::scope(|scope| -> Result<()> {
        let other = scope.spawn(|| invocation(None));
        invocation(None)?;
        other.join().unwrap()?;
        Ok(())
    })
}
