/// Existing bounded authenticated endpoint/custody, not another process owner.
struct CpuTransport<'a>(&'a Config);
impl super::cpu_reconnect::Transport for CpuTransport<'_> {
    fn post(&self, path: &str, body: &[u8], identity: Option<&super::cpu_reconnect::Identity>,
        binary: bool, cancel: Option<&AtomicBool>,
    ) -> Result<super::cpu_reconnect::WireReply, super::cpu_reconnect::Error> {
        use super::cpu_reconnect::{Error as ReconnectError, WireReply};
        let encoded = identity.map(serde_json::to_string).transpose().map_err(|_| ReconnectError::Uncertain)?;
        let request = self.0.request("POST", path)
            .set("Content-Type", if binary { "application/octet-stream" } else { "application/json" });
        let request = if let Some(encoded) = &encoded { request.set("X-Veyra-Identity", encoded) } else { request };
        let limit = if path.starts_with("/v2/operations/") { 8192 } else { 1_440_044 };
        let original = std::thread::scope(|scope| {
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            scope.spawn(move || {
                let result = match request.send_bytes(body) {
                    Ok(response) | Err(ureq::Error::Status(_, response)) => {
                        let status = response.status();
                        read(response, limit).map(|body| WireReply { status, body }).map_err(|_| ())
                    },
                    Err(_) => Err(()),
                };
                let _ = tx.send(result);
            });
            let mut requested = false;
            loop {
                if !requested && cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                    requested = true;
                    if let Some(identity) = identity {
                        // ACK is ignored. The original scope is still awaited,
                        // then a separately retained exact terminal is required.
                        let _ = self.0.request("POST", "/v2/operations/cancel").send_json(identity);
                    }
                }
                match rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(result) => break result,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {},
                    Err(_) => break Err(()),
                }
            }
        });
        original.map_err(|_| ReconnectError::Uncertain)
    }
}
