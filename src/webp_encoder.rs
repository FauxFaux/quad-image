//! A disposable Wasmtime sandbox for the checked-in lossy WebP encoder.
//!
//! The trusted, embedded module is compiled once and shared across calls. Only
//! compiled code and engine metadata are shared: each call instantiates it in a
//! fresh store on a dedicated OS thread. The thread is joined and its store (including
//! all linear memory) is dropped before returning, on success or failure.
//! No WASI or other filesystem/network capabilities are provided.
//!
//! The memory limit covers WASM linear memory, not total process RSS, compilation,
//! the caller's RGBA buffer, or the returned Vec. The epoch timeout covers guest
//! instantiation, initialization and encoding, not compilation or host work.
//! Timeouts round up to whole seconds; OS scheduling can delay interruption.

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context, Result};
use once_cell::sync::OnceCell;
use wasmtime::{
    Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder, Trap, UpdateDeadline,
};

const ENCODER: &[u8] = include_bytes!("../web/assets/webp-encode.wasm");
const EPOCH_INTERVAL: Duration = Duration::from_secs(1);
static COMPILED_ENCODER: OnceCell<Module> = OnceCell::new();

fn compiled_encoder() -> Result<&'static Module> {
    COMPILED_ENCODER.get_or_try_init(|| compile(ENCODER))
}

fn compile(wasm: &[u8]) -> Result<Module> {
    let mut config = Config::new();
    config.epoch_interruption(true);
    config.memory_reservation(0);
    config.memory_reservation_for_growth(0);
    let engine = Engine::new(&config)?;
    Module::new(&engine, wasm)
        .map_err(anyhow::Error::from)
        .context("compiling WebP sandbox")
}

/// Resource limits for one invocation. A new sandbox is created on every call.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Maximum WASM linear-memory bytes, including the module's initial memory.
    pub memory_bytes: usize,
    /// Guest execution timeout, rounded up to the next one-second epoch tick.
    pub timeout: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            memory_bytes: 256 * 1024 * 1024,
            timeout: Duration::from_secs(10),
        }
    }
}

/// Encode tightly packed RGBA pixels at WebP quality 0..=100.
///
/// This blocks until the disposable worker has exited. Callers in an async
/// application would need to move this blocking operation off their executor.
pub fn encode_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: f32,
    limits: Limits,
) -> Result<Vec<u8>> {
    ensure!((1..=16383).contains(&width), "invalid WebP width");
    ensure!((1..=16383).contains(&height), "invalid WebP height");
    ensure!(
        quality.is_finite() && (0.0..=100.0).contains(&quality),
        "quality must be finite and between 0 and 100"
    );
    let input_size = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .context("RGBA size overflow")?;
    ensure!(
        rgba.len() == input_size,
        "RGBA length does not match dimensions"
    );
    ensure!(
        input_size <= limits.memory_bytes,
        "RGBA exceeds memory limit"
    );

    run(limits, compiled_encoder()?, |store, module| {
        let mut linker = Linker::new(module.engine());
        linker.func_wrap("env", "emscripten_notify_memory_growth", |_: i32| {})?;
        let instance = linker.instantiate(&mut *store, module)?;
        instance
            .get_typed_func::<(), ()>(&mut *store, "_initialize")?
            .call(&mut *store, ())?;
        let memory = instance
            .get_memory(&mut *store, "memory")
            .context("encoder has no memory export")?;
        let malloc = instance.get_typed_func::<u32, u32>(&mut *store, "malloc")?;
        let free = instance.get_typed_func::<u32, ()>(&mut *store, "free")?;
        let webp_free = instance.get_typed_func::<u32, ()>(&mut *store, "WebPFree")?;
        let encode = instance
            .get_typed_func::<(u32, u32, u32, u32, f32, u32), u32>(&mut *store, "WebPEncodeRGBA")?;

        let input = malloc.call(&mut *store, input_size as u32)?;
        ensure!(input != 0, "could not allocate RGBA input");
        let output = malloc.call(&mut *store, 4)?;
        ensure!(output != 0, "could not allocate output pointer");
        memory.write(&mut *store, input as usize, rgba)?;
        memory.write(&mut *store, output as usize, &[0; 4])?;
        let size = encode.call(
            &mut *store,
            (input, width, height, width * 4, quality, output),
        )?;
        let mut pointer = [0; 4];
        memory.read(&*store, output as usize, &mut pointer)?;
        let encoded = u32::from_le_bytes(pointer);
        ensure!(size != 0 && encoded != 0, "WebP encoding failed");

        // Validate the entire guest range before allocating/copying host output.
        // Never retain a view into guest memory across a call or store teardown.
        let start = encoded as usize;
        let end = start
            .checked_add(size as usize)
            .context("output range overflow")?;
        let bytes = memory
            .data(&*store)
            .get(start..end)
            .context("WebP output lies outside guest memory")?
            .to_vec();
        webp_free.call(&mut *store, encoded)?;
        free.call(&mut *store, output)?;
        free.call(&mut *store, input)?;
        // On any earlier error/trap, dropping the whole store releases all
        // allocations without re-entering a failed or timed-out guest.
        Ok(bytes)
    })
}

fn run<F>(limits: Limits, module: &Module, operation: F) -> Result<Vec<u8>>
where
    F: FnOnce(&mut Store<StoreLimits>, &Module) -> Result<Vec<u8>> + Send,
{
    ensure!(limits.memory_bytes != 0, "memory limit must be positive");
    ensure!(!limits.timeout.is_zero(), "timeout must be positive");
    let ticks = limits
        .timeout
        .as_secs()
        .checked_add(u64::from(limits.timeout.subsec_nanos() != 0))
        .filter(|ticks| *ticks < u64::MAX)
        .context("timeout is too large")?;

    let budget = Duration::from_secs(ticks);
    ensure!(
        Instant::now().checked_add(budget).is_some(),
        "timeout is too large"
    );
    let engine = module.engine();

    thread::scope(|scope| {
        let (ready_tx, ready_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("webp-encoder".into())
            .spawn_scoped(scope, move || {
                let result = {
                    let resources = StoreLimitsBuilder::new()
                        .memory_size(limits.memory_bytes)
                        .memories(1)
                        .instances(1)
                        .tables(1)
                        .table_elements(1024)
                        .trap_on_grow_failure(true)
                        .build();
                    let mut store = Store::new(engine, resources);
                    store.limiter(|resources| resources);
                    let deadline = Instant::now()
                        .checked_add(budget)
                        .context("timeout is too large")?;
                    store.set_epoch_deadline(1);
                    // Other calls also tick this shared engine. Compare against
                    // this store's wall-clock deadline so those ticks only prompt
                    // a check; they cannot consume another call's time budget.
                    store.epoch_deadline_callback(move |_| {
                        if Instant::now() >= deadline {
                            Err(Trap::Interrupt.into())
                        } else {
                            Ok(UpdateDeadline::Continue(1))
                        }
                    });
                    let _ = ready_tx.send(());
                    operation(&mut store, module)
                }; // Drop the entire store before announcing completion.
                let _ = done_tx.send(());
                result
            })
            .context("starting WebP worker")?;

        if ready_rx.recv().is_ok() {
            loop {
                match done_rx.recv_timeout(EPOCH_INTERVAL) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => engine.increment_epoch(),
                }
            }
        }
        match worker.join() {
            Ok(result) => result.context("WebP sandbox failed"),
            Err(_) => bail!("WebP worker panicked"),
        }
    })
}

#[cfg(test)]
mod tests;
