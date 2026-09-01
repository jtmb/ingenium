export type ExecutionState = "preflight" | "running" | "cleaning" | "cleaned" | "failed";

export class ExecutionLifecycle {
  readonly controller = new AbortController();
  private cleanupPromise?: Promise<void>;
  private current: ExecutionState = "preflight";

  get signal(): AbortSignal { return this.controller.signal; }
  get state(): ExecutionState { return this.current; }

  start(): void {
    if (this.current !== "preflight" || this.signal.aborted) throw new Error("Harness cannot start from its current state");
    this.current = "running";
  }

  abort(reason: unknown = new Error("Harness aborted")): void {
    if (!this.signal.aborted) this.controller.abort(reason);
  }

  assertRunning(): void {
    if (this.current !== "running") throw new Error(`Harness is ${this.current}`);
    this.signal.throwIfAborted();
  }

  cleanup(action: () => Promise<void>): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.current = "cleaning";
    this.cleanupPromise = (async () => {
      try {
        await action();
        this.current = "cleaned";
      } catch (error) {
        this.current = "failed";
        throw error;
      }
    })();
    return this.cleanupPromise;
  }
}
