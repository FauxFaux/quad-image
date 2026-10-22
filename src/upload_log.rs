//! One JSON line per upload lifecycle event, including background completion.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::http::HeaderMap;
use serde_json::{json, Value};

use crate::ingest::StoreUpdate;

#[derive(Clone)]
pub(crate) struct UploadLog(Arc<Inner>);

struct Inner {
    context: Value,
    started: Instant,
    state: Mutex<Progress>,
    write: Box<dyn Fn(Value) + Send + Sync>,
}

#[derive(Default)]
struct Progress {
    image_id: Option<String>,
    selected: Option<Value>,
    ready: bool,
    finished: bool,
}

impl UploadLog {
    pub(crate) fn new(peer: SocketAddr, headers: &HeaderMap, legacy: bool) -> Self {
        Self::with_writer(peer, headers, legacy, |record| println!("{record}"))
    }

    pub(crate) fn with_writer(
        peer: SocketAddr,
        headers: &HeaderMap,
        legacy: bool,
        write: impl Fn(Value) + Send + Sync + 'static,
    ) -> Self {
        let forwarded_for = headers.get("X-Forwarded-For").map(|value| {
            value
                .to_str()
                .map(str::to_owned)
                .unwrap_or_else(|_| format!("{value:?}"))
        });
        let log = Self(Arc::new(Inner {
            context: json!({
                "component": "upload",
                "request_id": format!("{:032x}", rand::random::<u128>()),
                "peer": peer.to_string(),
                "forwarded_for": forwarded_for,
                "legacy": legacy,
                "endpoint": if legacy { "/api/upload" } else { "/api/upload-stream" },
            }),
            started: Instant::now(),
            state: Mutex::new(Progress::default()),
            write: Box::new(write),
        }));
        log.event("received", json!({}));
        log
    }

    fn record(&self, state: &Progress, event: &str, details: Value) {
        let mut record = self.0.context.clone();
        record["event"] = json!(event);
        record["image_id"] = json!(state.image_id);
        record["timestamp_ms"] = json!(SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis());
        record["elapsed_ms"] = json!(self.0.started.elapsed().as_millis());
        record
            .as_object_mut()
            .unwrap()
            .extend(details.as_object().unwrap().clone());
        (self.0.write)(record);
    }

    pub(crate) fn event(&self, event: &str, details: Value) {
        // Logging must still work after an encoder or callback panics.
        let state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.record(&state, event, details);
    }

    pub(crate) fn update(&self, update: &StoreUpdate<'_>) {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (event, details) = match update {
            StoreUpdate::Detected(format) => (
                "transcode",
                json!({
                    "input_format": format!("{format:?}"),
                    "policy": if *format == image::ImageFormat::Gif {
                        "gif-reencode"
                    } else {
                        "two-pass-webp"
                    },
                }),
            ),
            StoreUpdate::Assigned(id) => {
                state.image_id = Some((*id).to_owned());
                ("assigned", json!({}))
            }
            StoreUpdate::Decoded { width, height } => {
                ("decoded", json!({"width": width, "height": height}))
            }
            StoreUpdate::Thumbnail(_) => ("thumbnail", json!({})),
            StoreUpdate::Planned(names) => ("planned", json!({"names": names})),
            StoreUpdate::Encoded {
                name,
                bytes,
                improved,
            } => (
                "encoded",
                json!({"name": name, "bytes": bytes, "improved": improved}),
            ),
            StoreUpdate::Published { name, bytes } => {
                state.selected = Some(json!({"name": name, "bytes": bytes}));
                ("published", state.selected.clone().unwrap())
            }
            StoreUpdate::Image(_) => return,
        };
        self.record(&state, event, details);
    }

    pub(crate) fn ready(&self) {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.ready = true;
        self.record(&state, "ready", json!({"selected": state.selected}));
    }

    pub(crate) fn finish(&self, result: Result<(), String>) {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.finished {
            return;
        }
        state.finished = true;
        let retained = state
            .image_id
            .as_deref()
            .is_some_and(|id| std::path::Path::new(id).is_file());
        self.record(
            &state,
            "finished",
            json!({
                "success": result.is_ok(),
                "ready": state.ready,
                "retained": retained,
                "selected": state.selected,
                "error": result.err(),
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_the_sender_and_endpoint_before_failure() {
        for legacy in [false, true] {
            let records = Arc::new(Mutex::new(Vec::new()));
            let output = records.clone();
            let mut headers = HeaderMap::new();
            headers.insert(
                "X-Forwarded-For",
                "203.0.113.1, 203.0.113.2".parse().unwrap(),
            );
            let log = UploadLog::with_writer(
                "127.0.0.1:1234".parse().unwrap(),
                &headers,
                legacy,
                move |record| output.lock().unwrap().push(record),
            );
            log.update(&StoreUpdate::Assigned("e/abcdefghij.webp"));
            // The assignment record is already written, even though the upload
            // has neither a usable primary nor a successful response yet.
            assert_eq!(records.lock().unwrap().len(), 2);
            log.finish(Err("encoding nl100: timeout\nwith details".to_owned()));
            log.finish(Ok(()));
            let records = records.lock().unwrap();
            assert_eq!(records.len(), 3, "one terminal record per request");
            assert!(records[0]["image_id"].is_null());
            assert_eq!(records[1]["event"], "assigned");
            assert_eq!(records[2]["success"], false);
            assert_eq!(records[2]["ready"], false);
            assert_eq!(records[2]["retained"], false);
            for record in records.iter() {
                assert_eq!(record["peer"], "127.0.0.1:1234");
                assert_eq!(record["forwarded_for"], "203.0.113.1, 203.0.113.2");
                assert_eq!(record["legacy"], legacy);
                assert_eq!(record["request_id"], records[0]["request_id"]);
                assert_eq!(
                    record["endpoint"],
                    if legacy {
                        "/api/upload"
                    } else {
                        "/api/upload-stream"
                    }
                );
                assert!(record["timestamp_ms"].is_number());
                // Error text cannot split a JSON log record into forged lines.
                let line = record.to_string();
                assert_eq!(line.lines().count(), 1);
                assert_eq!(serde_json::from_str::<Value>(&line).unwrap(), *record);
            }
            assert_eq!(records[2]["image_id"], "e/abcdefghij.webp");
        }
    }

    #[test]
    fn records_readiness_separately_from_background_outcome() {
        for success in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let id = dir.path().join("abcdefghij.webp");
            std::fs::write(&id, b"published image").unwrap();
            let records = Arc::new(Mutex::new(Vec::new()));
            let output = records.clone();
            let log = UploadLog::with_writer(
                "127.0.0.1:1234".parse().unwrap(),
                &HeaderMap::new(),
                true,
                move |record| output.lock().unwrap().push(record),
            );
            log.update(&StoreUpdate::Assigned(id.to_str().unwrap()));
            log.update(&StoreUpdate::Published {
                name: "q70",
                bytes: 500,
            });
            log.ready();
            log.event("response", json!({"status": 200}));
            log.update(&StoreUpdate::Published {
                name: "nl100",
                bytes: 900,
            });
            log.finish(if success {
                Ok(())
            } else {
                Err("later optimization failed".to_owned())
            });
            let records = records.lock().unwrap();
            let ready = records
                .iter()
                .find(|record| record["event"] == "ready")
                .unwrap();
            assert_eq!(ready["selected"]["name"], "q70");
            let finished = records.last().unwrap();
            assert_eq!(finished["event"], "finished");
            assert_eq!(finished["success"], success);
            assert_eq!(finished["ready"], true);
            assert_eq!(finished["retained"], true);
            assert_eq!(finished["selected"], json!({"name": "nl100", "bytes": 900}));
        }
    }
}
