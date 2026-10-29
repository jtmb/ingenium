export type FreshConversationResult =
  | { kind: "accepted" | "review"; sessionId: string }
  | { kind: "unavailable" | "cancelled" | "busy" };

export interface FreshConversationBinding<Input> {
  sessionId: string | null;
  ready: boolean;
  error: string | null;
  send: (input: Input, current: () => boolean) => Promise<boolean>;
}

/** One explicit Home send owns one new conversation. Publishing readiness is read-only. */
export class FreshConversationStart<Input> {
  private active = false;
  private generation = 0;
  private flight: object | null = null;
  private binding: FreshConversationBinding<Input> | null = null;
  private waiting: { sessionId: string; resolve: (binding: FreshConversationBinding<Input> | null) => void } | null = null;
  private attemptedSession: string | null = null;

  constructor(private readonly preparationTimeoutMs = 30_000) {}

  isActive(): boolean { return this.active; }

  activate(): () => void {
    this.active = true;
    const generation = ++this.generation;
    return () => {
      if (this.generation !== generation) return;
      this.active = false;
      this.waiting?.resolve(null);
    };
  }

  publish(binding: FreshConversationBinding<Input>): void {
    this.binding = binding;
    if (binding.ready && binding.sessionId === this.waiting?.sessionId) this.waiting.resolve(binding);
  }

  async start(create: () => Promise<string | null>, input: Input, existingSessionIds: readonly string[] = []): Promise<FreshConversationResult> {
    if (!this.active) return { kind: "cancelled" };
    if (this.flight) return { kind: "busy" };
    if (this.attemptedSession) return { kind: "review", sessionId: this.attemptedSession };
    const flight = {};
    const generation = this.generation;
    const current = () => this.active && this.generation === generation && this.flight === flight;
    this.flight = flight;
    try {
      const sessionId = await create();
      if (!current()) return { kind: "cancelled" };
      if (!sessionId) return { kind: "unavailable" };
      this.attemptedSession = sessionId;
      if (existingSessionIds.includes(sessionId)) return { kind: "review", sessionId };
      const binding = await this.waitFor(sessionId);
      if (!current()) return { kind: "cancelled" };
      if (!binding || binding.error) return { kind: "review", sessionId };
      const ownsSession = () => current() && this.binding?.sessionId === sessionId && this.binding.ready;
      if (!ownsSession()) return { kind: "review", sessionId };
      // Only this explicit handler continuation submits a prompt. publish() never sends.
      const accepted = await binding.send(input, ownsSession);
      if (!current()) return { kind: "cancelled" };
      return { kind: accepted ? "accepted" : "review", sessionId };
    } catch {
      return this.attemptedSession
        ? { kind: "review", sessionId: this.attemptedSession }
        : { kind: "unavailable" };
    } finally {
      if (this.flight === flight) this.flight = null;
    }
  }

  private waitFor(sessionId: string): Promise<FreshConversationBinding<Input> | null> {
    if (this.binding?.sessionId === sessionId && this.binding.ready) return Promise.resolve(this.binding);
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(null), this.preparationTimeoutMs);
      const finish = (binding: FreshConversationBinding<Input> | null) => {
        clearTimeout(timer);
        if (this.waiting?.resolve === finish) this.waiting = null;
        resolve(binding);
      };
      this.waiting = { sessionId, resolve: finish };
    });
  }
}
