import { UUID, clone, createWire, operationWire, identity, realm, same, sha256, requireValue, workspaceObservation, verifiedReceipt, verifiedPromptOriginal, createdSession } from "./local-protocol.mjs";

/** Retained client originals, never another workspace or transcript authority. */
export class LocalChatController {
  constructor({ identity: actual, flowID, store, transport, current, uuid = () => crypto.randomUUID() }) {
    this.identity = identity(actual);
    requireValue(UUID.test(flowID), "Choose the retained original before opening this chat.");
    this.flowID = flowID; this.store = store; this.transport = transport; this.current = current; this.uuid = uuid;
    this.key = "veyra.local-chat.original.v1:" + encodeURIComponent(realm(actual)) + ":" + flowID;
    this.listeners = new Set(); this.busy = false;
    this.snapshot = { loaded: false, busy: false, error: null, journal: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  publish(journal, error = null) {
    this.snapshot = Object.freeze({ loaded: this.snapshot.loaded || (!this.busy && journal !== null), busy: this.busy, error, journal: journal ? clone(journal) : null });
    for (const listener of this.listeners) listener();
  }
  requireCurrent() { requireValue(this.current(), "This local view changed. The original was kept; no further effect was sent."); }
  empty() {
    return { schema: 1, flow_id: this.flowID, identity: clone(this.identity), draft: "", agent: "",
      plan: null, workspace: null, session: null, prompts: [], controls: [], sequence: 0, error: null };
  }
  async decode(raw) {
    if (raw === null) return this.empty();
    let journal;
    try { journal = JSON.parse(raw); } catch { throw new Error("Saved originals are unreadable. Their bytes were kept."); }
    requireValue(journal?.schema === 1 && journal.flow_id === this.flowID && realm(journal.identity) === realm(this.identity)
      && typeof journal.draft === "string" && typeof journal.agent === "string" && Number.isSafeInteger(journal.sequence)
      && Array.isArray(journal.prompts) && journal.prompts.length <= 64, "Saved originals have a different or invalid owner.");
    journal.controls ??= [];
    requireValue(Array.isArray(journal.controls) && journal.controls.length <= 64, "Saved control originals are invalid.");
    for (const seal of [journal.workspace?.seal, journal.session, ...journal.prompts, ...journal.controls].filter(Boolean)) {
      requireValue(["reserved", "unknown", "committed", "rejected"].includes(seal.phase) && typeof seal.wire === "string"
        && seal.sha256 === await sha256(seal.wire), "A saved original changed. Its bytes were kept.");
      const body = JSON.parse(seal.wire);
      const expected = body.operation ? operationWire(body.request_id, body.owner, body.operation) : createWire(body.request_id, body.environment);
      requireValue(expected === seal.wire, "A saved request is not the exact typed original.");
      if (body.operation && seal.receipt) verifiedReceipt(seal.receipt, seal);
      if (body.operation && ["committed", "rejected"].includes(seal.phase)) {
        if (body.operation.kind === "agent_turn" && seal.original_receipt) {
          await verifiedPromptOriginal(seal.original_receipt, seal, body.operation.session_id, journal.workspace?.observation?.workspace.root_path);
          requireValue(seal.original_receipt.admission === (seal.phase === "committed" ? "admitted" : "rejected"), "Original prompt settlement changed.");
        } else {
          requireValue(seal.receipt?.state === "committed", "A settled original has no verified committed receipt.");
          if (body.operation.kind === "agent_turn") requireValue(seal.receipt.result?.request_id === body.request_id
            && seal.receipt.result?.admission === (seal.phase === "committed" ? "admitted" : "rejected"), "Prompt settlement changed.");
        }
      }
      if (seal.original_receipt) await verifiedPromptOriginal(seal.original_receipt, seal, body.operation?.session_id, journal.workspace?.observation?.workspace.root_path);
    }
    if (journal.workspace?.seal.phase === "committed") workspaceObservation(journal.workspace.observation, journal.identity, this.flowID);
    if (journal.session?.phase === "committed") {
      const expected = createdSession(journal.session.receipt, { sessionWire: journal.session.wire, rootPath: journal.workspace?.observation?.workspace.root_path });
      requireValue(same(expected, journal.session.observation), "The retained session observation changed.");
    }
    for (const seal of [journal.session, ...journal.prompts, ...journal.controls].filter(Boolean)) {
      const body = JSON.parse(seal.wire);
      requireValue(body.operation && same(body.owner, journal.workspace?.observation?.owner), "A retained operation has a different workspace owner.");
      if (seal === journal.session) requireValue(body.operation.kind === "session_create", "The retained creation kind changed.");
      else {
        requireValue(body.operation.session_id === journal.session?.observation?.id &&
          (journal.prompts.includes(seal) ? body.operation.kind === "agent_turn" : ["session_interrupt", "session_select_agent", "session_select_model"].includes(body.operation.kind)), "A retained operation has a different conversation or kind.");
      }
    }
    if (journal.plan) {
      requireValue(typeof journal.plan.wire === "string" && journal.plan.sha256 === await sha256(journal.plan.wire), "The captured input changed.");
      const plan = JSON.parse(journal.plan.wire);
      requireValue(typeof plan.text === "string" && plan.text.length <= 65536 && typeof plan.agent === "string" &&
        UUID.test(plan.session_request_id) && UUID.test(plan.prompt_request_id) &&
        new Set([this.flowID, plan.session_request_id, plan.prompt_request_id]).size === 3, "The captured original plan is invalid.");
    }
    return journal;
  }
  async transaction(work) {
    requireValue(!this.busy, "This original is already being handled.");
    this.busy = true; this.publish(this.snapshot.journal, this.snapshot.error);
    let journal;
    try {
      return await this.store.withLock(this.key, async () => {
        let raw = this.store.read(this.key);
        journal = await this.decode(raw);
        const save = () => {
          journal.sequence++;
          const next = JSON.stringify(journal);
          this.store.put(this.key, raw, next);
          raw = next; this.publish(journal);
        };
        try { const result = await work(journal, save); return result; }
        catch (error) {
          journal.error ??= error instanceof Error ? error.message : "Local operation could not be confirmed.";
          try { save(); } catch { /* Keep the prior durable fence; never dispatch after a failed save. */ }
          throw error;
        }
      });
    } catch (error) {
      // Never publish an unretained acknowledgement as settled after CAS/quota
      // failure. Reload only the last verifiable durable original.
      try { journal = await this.decode(this.store.read(this.key)); } catch { journal = this.snapshot.journal; }
      this.publish(journal, error instanceof Error ? error.message : "Local originals unavailable.");
      throw error;
    } finally {
      this.busy = false;
      this.publish(journal ?? this.snapshot.journal, this.snapshot.error);
    }
  }
  async restore() { return this.transaction(async journal => { this.publish(journal); }); }
  async setDraft(text, agent) {
    requireValue(typeof text === "string" && text.length <= 65536 && typeof agent === "string" && agent.length <= 128, "This draft exceeds its bounded input size.");
    return this.transaction(async (journal, save) => {
      requireValue(!this.unresolved(journal), "An original still needs checking. Its draft was kept.");
      journal.draft = text; journal.agent = agent; save();
    });
  }
  unresolved(journal) {
    return [journal.workspace?.seal, journal.session, ...journal.prompts, ...(journal.controls ?? [])].some(seal => seal?.phase === "unknown");
  }
  async seal(wire) { return { wire, sha256: await sha256(wire), phase: "reserved", receipt: null }; }
  /** Explicit allocation before selecting an actual private runtime agent.
   * The draft remains durable; this never creates a session or submits text. */
  async prepareWorkspace() {
    return this.transaction(async (journal, save) => {
      this.requireCurrent();
      requireValue(same(journal.identity, this.identity) && !this.unresolved(journal), "Check the retained original first.");
      if (!journal.workspace) { journal.workspace = { seal: await this.seal(createWire(this.flowID, this.identity.environment)), observation: null }; save(); }
      requireValue(journal.workspace.seal.phase === "reserved", "The original workspace will not be allocated again.");
      journal.workspace.seal.phase = "unknown"; save();
      const reply = await this.transport.createWorkspace(JSON.parse(journal.workspace.seal.wire), this.current);
      journal.workspace.observation = workspaceObservation(reply, journal.identity, this.flowID);
      journal.workspace.seal.phase = "committed"; save();
    });
  }
  settleControl(journal, save, seal, receipt) {
    const op = JSON.parse(seal.wire).operation, result = receipt.result;
    requireValue(receipt.state === "committed" && result?.session_id === op.session_id, "The control original remains unresolved; it will not be repeated.");
    if (op.kind === "session_interrupt") requireValue(typeof result.interrupted === "boolean" && result.scope === "current_conversation" && result.exact_turn_guarantee === false && result.terminal_observed === false, "The generic interruption result is invalid.");
    else if (op.kind === "session_select_agent") requireValue(result.agent === op.agent, "The selected agent was not observed.");
    else requireValue(op.kind === "session_select_model" && result.model?.id === op.model_id, "The selected model was not observed.");
    seal.phase = "committed"; save();
  }
  async control(operation) {
    return this.transaction(async (journal, save) => {
      this.requireCurrent();
      requireValue(!this.unresolved(journal) && journal.session?.phase === "committed" && journal.controls.length < 64, "Check original outcomes before another control.");
      requireValue(["session_interrupt", "session_select_model", "session_select_agent"].includes(operation?.kind) && operation.session_id === journal.session.observation.id, "This control is not bound to the original session.");
      const actual = await this.fresh(journal);
      const seal = await this.seal(operationWire(this.uuid(), actual.owner, operation));
      journal.controls.push(seal); save();
      this.settleControl(journal, save, seal, await this.dispatch(journal, save, seal));
    });
  }
  async fresh(journal) {
    this.requireCurrent();
    requireValue(same(journal.identity, this.identity), "The service instance changed. Old originals remain read-only.");
    const fresh = workspaceObservation(await this.transport.readWorkspace(this.flowID, this.current), journal.identity, this.flowID);
    requireValue(journal.workspace?.observation && same(fresh.owner, journal.workspace.observation.owner)
      && fresh.workspace.root_path === journal.workspace.observation.workspace.root_path
      && fresh.workspace.root_identity === journal.workspace.observation.workspace.root_identity,
      "The original local workspace revision or custody changed.");
    this.requireCurrent();
    return fresh;
  }
  async dispatch(journal, save, seal) {
    requireValue(seal.phase === "reserved", "This original will not be submitted again. Check its receipt.");
    await this.fresh(journal);
    this.requireCurrent();
    seal.phase = "unknown"; save(); // durable dispatch fence BEFORE invoking the gateway
    const reply = await this.transport.dispatch(JSON.parse(seal.wire), this.current);
    const verified = verifiedReceipt(reply, seal);
    seal.receipt = verified;
    // Committed operation does not necessarily mean an admitted prompt.
    save();
    return verified;
  }
  settleSession(journal, save, receipt) {
    requireValue(receipt.state === "committed", "Conversation creation is still unresolved; no new creation was sent.");
    const session = createdSession(receipt, { sessionWire: journal.session.wire, rootPath: journal.workspace.observation.workspace.root_path });
    journal.session.phase = "committed"; journal.session.observation = session; save();
  }
  settlePrompt(journal, save, seal, receipt) {
    requireValue(receipt.state === "committed", "The prompt outcome remains unknown; it will not be repeated.");
    this.settlePromptResult(journal, save, seal, receipt.result);
  }
  settlePromptResult(journal, save, seal, result) {
    const original = JSON.parse(seal.wire);
    requireValue(result?.request_id === original.request_id && ["admitted", "uncertain", "rejected"].includes(result.admission), "The prompt result is not the retained original outcome.");
    if (result.admission === "admitted") {
      requireValue(typeof result.message_id === "string" && result.message_id, "The admitted message identity is unavailable.");
      seal.phase = "committed";
      if (journal.draft === original.operation.text) journal.draft = "";
      journal.plan = null; save();
    } else if (result.admission === "rejected") {
      seal.phase = "rejected"; journal.plan = null; save();
      throw new Error("The service rejected this original. Your text was kept. A new prompt requires an explicit new send.");
    } else {
      save();
      throw new Error("Prompt admission is uncertain. The original will not be repeated.");
    }
  }
  async send() {
    return this.transaction(async (journal, save) => {
      this.requireCurrent();
      requireValue(!this.unresolved(journal), "Check the original outcome before sending another prompt.");
      requireValue(same(journal.identity, this.identity), "This service instance cannot admit the old original.");
      requireValue(journal.plan || journal.draft.trim(), "Write a message first.");
      requireValue(journal.prompts.length < 64, "Original history is full; it was preserved.");
      if (!journal.plan) {
        requireValue(journal.session || journal.agent.trim(), "Choose an actual available primary agent first.");
        const plan = { text: journal.draft, agent: journal.agent, session_request_id: this.uuid(), prompt_request_id: this.uuid() };
        requireValue(UUID.test(plan.session_request_id) && UUID.test(plan.prompt_request_id) &&
          new Set([this.flowID, plan.session_request_id, plan.prompt_request_id]).size === 3, "Original IDs are unavailable.");
        const wire = JSON.stringify(plan); journal.plan = { wire, sha256: await sha256(wire) };
        // Capture the entire first-input plan before workspace allocation.
        save();
      }
      const plan = JSON.parse(journal.plan.wire);
      if (!journal.workspace) {
        journal.workspace = { seal: await this.seal(createWire(this.flowID, this.identity.environment)), observation: null };
        save();
      }
      if (journal.workspace.seal.phase === "reserved") {
        this.requireCurrent();
        journal.workspace.seal.phase = "unknown"; save();
        const reply = await this.transport.createWorkspace(JSON.parse(journal.workspace.seal.wire), this.current);
        journal.workspace.observation = workspaceObservation(reply, journal.identity, this.flowID);
        journal.workspace.seal.phase = "committed"; save();
      }
      this.requireCurrent();
      if (!journal.session) {
        const actual = await this.fresh(journal);
        journal.session = await this.seal(operationWire(plan.session_request_id, actual.owner,
          { kind: "session_create", title: "Local conversation", agent: plan.agent }));
        save();
      }
      if (journal.session.phase === "reserved") this.settleSession(journal, save, await this.dispatch(journal, save, journal.session));
      requireValue(journal.session.phase === "committed", "The original conversation is not confirmed.");
      this.requireCurrent();
      let prompt = journal.prompts.find(item => JSON.parse(item.wire).request_id === plan.prompt_request_id);
      if (!prompt) {
        const actual = await this.fresh(journal);
        const session = journal.session.observation;
        const observed = await this.transport.readSession(this.flowID, session.id, this.current);
        requireValue(observed?.id === session.id && observed.location?.directory === actual.workspace.root_path, "The actual local conversation changed.");
        this.requireCurrent();
        prompt = await this.seal(operationWire(plan.prompt_request_id, actual.owner,
          { kind: "agent_turn", session_id: session.id, text: plan.text }));
        journal.prompts.push(prompt); save();
      }
      if (prompt.phase === "reserved") this.settlePrompt(journal, save, prompt, await this.dispatch(journal, save, prompt));
    });
  }
  /** Read-only recovery. Never invokes send, createWorkspace or dispatch. */
  async checkOriginals() {
    return this.transaction(async (journal, save) => {
      this.requireCurrent();
      if (journal.workspace?.seal.phase === "unknown") {
        journal.workspace.observation = workspaceObservation(await this.transport.readWorkspace(this.flowID, this.current), journal.identity, this.flowID);
        journal.workspace.seal.phase = "committed"; save();
      }
      if (journal.session?.phase === "unknown") {
        const receipt = verifiedReceipt(await this.transport.readReceipt(JSON.parse(journal.session.wire).request_id, this.current), journal.session);
        journal.session.receipt = receipt; save(); this.settleSession(journal, save, receipt);
      }
      for (const prompt of journal.prompts.filter(item => item.phase === "unknown")) {
        const body = JSON.parse(prompt.wire);
        const reply = await this.transport.readPromptOriginal(this.flowID, body.operation.session_id, body.request_id, this.current);
        requireValue(reply !== null, "No matching retained prompt record was found. Absence is not permission to resend.");
        const original = await verifiedPromptOriginal(reply, prompt, body.operation.session_id, journal.workspace.observation.workspace.root_path);
        this.requireCurrent();
        prompt.original_receipt = original; save();
        // Retain the immutable operation receipt separately; only the actual
        // prompt journal can resolve its uncertain admission projection.
        this.settlePromptResult(journal, save, prompt, original);
      }
      for (const seal of journal.controls.filter(item => item.phase === "unknown")) {
        const receipt = verifiedReceipt(await this.transport.readReceipt(JSON.parse(seal.wire).request_id, this.current), seal);
        seal.receipt = receipt; save(); this.settleControl(journal, save, seal, receipt);
      }
      // Prepared continuation remains an explicit later user action.
    });
  }
}
