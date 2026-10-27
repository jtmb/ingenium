/** Parse bounded native CLI events without retaining or logging model content. */
export class JobResponseVerification {
  private pending = Buffer.alloc(0);
  private responseSeen = false;
  private providerError = false;
  private invalid = false;
  private finished = false;
  static readonly MAX_EVENT_BYTES = 1024 * 1024;

  accept(chunk: Buffer | string): void {
    if (this.finished || this.invalid) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = Buffer.concat([this.pending, incoming]);
    this.pending.fill(0);
    this.pending = Buffer.alloc(0);
    try {
      let start = 0;
      for (let end = combined.indexOf(10); end !== -1; end = combined.indexOf(10, start)) {
        if (end - start > JobResponseVerification.MAX_EVENT_BYTES) { this.invalid = true; return; }
        this.event(combined.subarray(start, end));
        start = end + 1;
      }
      if (combined.length - start > JobResponseVerification.MAX_EVENT_BYTES) { this.invalid = true; return; }
      this.pending = Buffer.from(combined.subarray(start));
    } finally { combined.fill(0); }
  }

  private event(bytes: Buffer): void {
    const text = bytes.toString("utf8").trim();
    if (!text) return;
    let value: unknown;
    try { value = JSON.parse(text); } catch { this.invalid = true; return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) { this.invalid = true; return; }
    const event = value as Record<string, unknown>;
    const part = event.part && typeof event.part === "object" && !Array.isArray(event.part)
      ? event.part as Record<string, unknown> : undefined;
    if (event.type === "error" || event.error || part?.reason === "error") this.providerError = true;
    const time = part?.time && typeof part.time === "object" ? part.time as Record<string, unknown> : undefined;
    if (event.type === "text" && part?.type === "text" && typeof part.text === "string"
      && part.text.trim().length > 0 && typeof time?.end === "number" && Number.isFinite(time.end)) {
      this.responseSeen = true;
    }
    if (event.type === "step_finish" && part?.type === "step-finish" && part.reason === "stop") {
      this.responseSeen = true;
    }
  }

  finish(): { verified: boolean; responseSeen: boolean; providerError: boolean; invalid: boolean } {
    if (!this.finished) {
      try { this.event(this.pending); } finally { this.pending.fill(0); this.pending = Buffer.alloc(0); this.finished = true; }
    }
    return { verified: this.responseSeen && !this.providerError && !this.invalid,
      responseSeen: this.responseSeen, providerError: this.providerError, invalid: this.invalid };
  }
}
