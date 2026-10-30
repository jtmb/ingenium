import { clone, owner, same, requireValue } from "./local-protocol.mjs";
const opaque = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export function webBounds(value) {
  const keys = ["x", "y", "width", "height", "viewport_width", "viewport_height"];
  requireValue(value && Object.keys(value).sort().join() === keys.sort().join() && keys.every(key => Number.isFinite(value[key])) &&
    value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 &&
    value.viewport_width > 0 && value.viewport_height > 0 && value.viewport_width <= 32768 && value.viewport_height <= 32768 &&
    value.x + value.width <= value.viewport_width + 0.5 && value.y + value.height <= value.viewport_height + 0.5,
    "The Web viewport is not available.");
  return clone(value);
}
/** Root-only port injection. No URL, token, generic invoke or fake host fallback. */
export class LocalWebController {
  constructor({ actualOwner, sessionID, port, current, refreshWork, cleanupFailure }) {
    this.owner = owner(actualOwner); this.sessionID = sessionID; this.port = port; this.current = current;
    requireValue(/^ses_[A-Za-z0-9_-]{1,128}$/.test(sessionID), "The Web conversation is not confirmed.");
    requireValue(typeof refreshWork === "function" && typeof cleanupFailure === "function", "Original refresh and cleanup reporting are required.");
    this.refreshWork = refreshWork; this.cleanupFailure = cleanupFailure;
    this.binding = null; this.pending = null; this.busy = false; this.disposed = false; this.listeners = new Set();
    this.snapshot = { view: "work", busy: false, pending: null, error: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  publish(view = this.snapshot.view, error = null) {
    this.snapshot = Object.freeze({ view, busy: this.busy, pending: this.pending, error });
    for (const listener of this.listeners) listener();
  }
  checkCurrent() { requireValue(!this.disposed && this.current(), "The conversation changed; the Web binding was not redirected."); }
  verifiedState(reply) {
    requireValue(this.binding && reply?.binding_id === this.binding.binding_id && reply.invalidation_epoch === this.binding.invalidation_epoch &&
      ["hidden", "visible", "closed"].includes(reply.visibility), "The actual Web host state was not confirmed.");
    return reply.visibility;
  }
  async enter(bounds) {
    requireValue(!this.busy && !this.pending, "Check the Web view outcome before another action.");
    this.busy = true; this.publish("web");
    try {
      this.checkCurrent(); const rect = webBounds(bounds);
      if (!this.binding) {
        const reply = await this.port.readBinding({ owner: this.owner, session_id: this.sessionID }, this.current);
        requireValue(reply?.kind === "qualified", reply?.reason ?? "Web is unavailable for this conversation.");
        requireValue(opaque(reply.binding_id) && opaque(reply.invalidation_epoch) && same(owner(reply.owner), this.owner) && reply.session_id === this.sessionID &&
          Object.keys(reply).every(key => ["kind", "binding_id", "invalidation_epoch", "owner", "session_id"].includes(key)), "The original Web binding is invalid.");
        this.binding = clone(reply);
        if (this.disposed || !this.current()) { await this.dispose(); throw new Error("The conversation changed; the retained Web binding was released."); }
      }
      this.checkCurrent(); this.pending = "show"; this.publish("web");
      requireValue(this.verifiedState(await this.port.show(this.binding, rect, this.current)) === "visible", "The Web view was not shown.");
      this.checkCurrent(); this.pending = null;
    } catch (error) { this.publish("web", error instanceof Error ? error.message : "The Web view outcome is unknown."); throw error; }
    finally { this.busy = false; this.publish(this.snapshot.view, this.snapshot.error); }
  }
  async work() {
    requireValue(!this.busy && !this.pending, "Check the Web view outcome before returning.");
    this.busy = true; this.publish();
    try {
      if (this.binding) {
        this.pending = "hide"; this.publish();
        requireValue(this.verifiedState(await this.port.hide(this.binding)) === "hidden", "The Web view hide was not confirmed.");
        this.pending = null;
      }
      this.publish("work");
      this.checkCurrent(); await this.refreshWork(); // actual original owner reads only
    } catch (error) { this.publish(this.snapshot.view, error instanceof Error ? error.message : "The Web view outcome is unknown."); throw error; }
    finally { this.busy = false; this.publish(this.snapshot.view, this.snapshot.error); }
  }
  async check() {
    requireValue(this.binding && !this.busy, "No retained Web binding is available to check.");
    const visibility = this.verifiedState(await this.port.readState(this.binding));
    this.pending = null;
    if (visibility === "closed") this.binding = null;
    this.publish(visibility === "visible" ? "web" : "work");
  }
  async resize(bounds) {
    if (!this.binding || this.snapshot.view !== "web" || this.busy) return;
    try {
      this.checkCurrent();
      // Bounds never creates or shows a child; it remains safe during outcome recovery.
      this.verifiedState(await this.port.bounds(this.binding, webBounds(bounds), this.current));
    } catch (error) { this.publish(this.snapshot.view, this.snapshot.error ?? "The Web viewport resize was not confirmed."); throw error; }
  }
  async dispose() {
    this.disposed = true;
    if (!this.binding) return;
    const retained = this.binding;
    this.pending = "release"; this.publish();
    try {
      requireValue(this.verifiedState(await this.port.release(retained)) === "closed", "Web child removal is not confirmed.");
      this.binding = null; this.pending = null; this.publish("work");
    } catch (error) {
      this.publish(this.snapshot.view, "Web child cleanup requires reconciliation.");
      this.cleanupFailure(retained.binding_id, error); throw error;
    }
  }
}
/** These proposed commands must be guarded by the actual requesting Webview. */
export function createLocalWebPort(invoke) {
  requireValue(typeof invoke === "function", "The original native Web host is unavailable.");
  const key = binding => { requireValue(opaque(binding?.binding_id) && opaque(binding?.invalidation_epoch), "Invalid Web binding."); return { binding_id: binding.binding_id, invalidation_epoch: binding.invalidation_epoch }; };
  return {
    readBinding: (request, current) => {
      requireValue(current() && request && Object.keys(request).sort().join() === "owner,session_id" && /^ses_[A-Za-z0-9_-]{1,128}$/.test(request.session_id), "The conversation changed or its owner is invalid.");
      return invoke("read_local_web_binding", { request: { owner: owner(request.owner), session_id: request.session_id } });
    },
    show: (binding, bounds, current) => { requireValue(current(), "The conversation changed."); return invoke("show_local_web_child", { ...key(binding), bounds: webBounds(bounds) }); },
    bounds: (binding, bounds, current) => { requireValue(current(), "The conversation changed."); return invoke("bound_local_web_child", { ...key(binding), bounds: webBounds(bounds) }); },
    hide: binding => invoke("hide_local_web_child", key(binding)),
    readState: binding => invoke("read_local_web_child", key(binding)),
    release: binding => invoke("release_local_web_child", key(binding)),
  };
}
