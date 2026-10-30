    /// Explicit v2 entry only when the existing supervisor supplies its actual
    /// original/process/durable owner port. The default v1 execute is unchanged.
    pub(super) fn execute_cpu_owned(&self, id: &str, input: Input, cancel: &AtomicBool,
        owner: &dyn super::cpu_reconnect::SupervisorOwner,
    ) -> Result<super::cpu_reconnect::RemoteResult, Failure> {
        self.validate(&input)?;
        if cancel.load(Ordering::Acquire) { return Err(Failure::Known(Error::Unavailable)); }
        let health = self.health()?;
        let worker: super::cpu_reconnect::LeaseInfo = serde_json::from_value(health["ownership"].clone())
            .map_err(|_| Failure::Known(Error::Unconfigured))?;
        let (kind, body) = match input {
            Input::Transcribe(wav) => ("transcribe", wav[44..].to_vec()),
            Input::Synthesize { text, voice } => ("synthesize",
                serde_json::to_vec(&json!({"requestId":id,"text":text,"voice":voice})).map_err(|_| Error::Invalid)?),
        };
        super::cpu_reconnect::execute(owner, &CpuTransport(self), &self.instance, id, kind, &body, &worker, cancel)
            .map_err(|_| Failure::RemoteUncertain)
    }
    /// Does not require model readiness/health or issue a reserve/execute. Root
    /// must load the exact persisted original tuple; missing state stays unknown.
    pub(super) fn reconcile_cpu_owned(&self, original: &super::cpu_reconnect::Identity,
        owner: &dyn super::cpu_reconnect::SupervisorOwner,
    ) -> Result<super::cpu_reconnect::RemoteResult, Failure> {
        if original.instance_id != self.instance { return Err(Failure::RemoteUncertain); }
        super::cpu_reconnect::reconcile(owner, &CpuTransport(self), original)
            .map_err(|_| Failure::RemoteUncertain)
    }
