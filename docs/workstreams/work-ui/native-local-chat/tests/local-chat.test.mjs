import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { LocalChatController } from "../sources/apps/web/src/features/work-ui/local/local-chat-controller.mjs";
import { operationWire, sha256, createLocalTransport } from "../sources/apps/web/src/features/work-ui/local/local-protocol.mjs";
import { browserOriginalStore } from "../sources/apps/web/src/features/work-ui/local/local-original-store.mjs";
import { environmentSelections, identityFromContext, messagePage, readConversation } from "../sources/apps/web/src/features/work-ui/local/local-observations.mjs";
import { initialLocalFlows, localFlows } from "../sources/apps/web/src/features/work-ui/local/local-flow-index.mjs";
globalThis.crypto ??= webcrypto;
const flow = "11111111-1111-4111-8111-111111111111";
const actual = { installation_id: "actual-library", custodian_key: "actual-os-custodian",
  service_instance_id: "original-instance", environment: { kind: "windows" } };
function fixture() {
  const memory = new Map(), receipts = new Map(), calls = [], state = { current: true, fail: "", lose: "", badHash: false, counter: 1 };
  let lock = false;
  const store = {
    read: key => memory.get(key) ?? null,
    put(key, before, after) { assert.equal(memory.get(key) ?? null, before); if (state.fail && state.fail(after)) throw Error("storage denied"); memory.set(key, after); },
    async withLock(_key, work) { if (lock) throw Error("busy"); lock = true; try { return await work(); } finally { lock = false; } },
  };
  const owner = { installation_id: actual.installation_id, custodian_key: actual.custodian_key, workspace_id: flow,
    revision: 0, service_instance_id: actual.service_instance_id, environment: actual.environment };
  const workspace = { owner, workspace: { id: flow, environment: actual.environment, revision: 0, state: "active", root_path: "C:\\private\\one", root_identity: "physical-original" } };
  const persisted = () => JSON.parse([...memory.values()][0]);
  const transport = {
    async createWorkspace(body) {
      calls.push(["create", body]); assert.equal(persisted().workspace.seal.phase, "unknown");
      if (persisted().plan) assert.equal(JSON.parse(persisted().plan.wire).text, persisted().draft);
      if (state.lose === "create") throw Error("lost create acknowledgement");
      return workspace;
    },
    async readWorkspace() { calls.push(["read-workspace"]); return workspace; },
    async dispatch(body) {
      calls.push([body.operation.kind, body]);
      const journal = persisted(), seal = body.operation.kind === "session_create" ? journal.session : body.operation.kind === "agent_turn" ? journal.prompts.at(-1) : journal.controls.at(-1);
      assert.equal(seal.phase, "unknown"); assert.equal(seal.wire, JSON.stringify(body));
      const result = body.operation.kind === "session_create"
        ? { result_kind: "session_created", session: { id: "ses_" + body.request_id.replaceAll("-", ""), location: { directory: workspace.workspace.root_path }, agent: "build" } }
        : body.operation.kind === "agent_turn" ? { request_id: body.request_id, message_id: "msg-actual-receipt", admission: state.lose === "uncertain" ? "uncertain" : "admitted" }
        : { session_id: body.operation.session_id, interrupted: true, scope: "current_conversation", terminal_observed: false, exact_turn_guarantee: false };
      const reply = { request_id: body.request_id, owner: body.owner, request_sha256: await sha256(operationWire(body.request_id, body.owner, body.operation)), state: "committed", result };
      receipts.set(body.request_id, reply);
      if (state.lose === body.operation.kind) throw Error("lost operation acknowledgement");
      return reply;
    },
    async readSession(_workspace, sessionID) { calls.push(["read-session"]); return { id: sessionID, location: { directory: workspace.workspace.root_path } }; },
    async readReceipt(id) { calls.push(["read-receipt"]); const reply = structuredClone(receipts.get(id)); if (state.badHash) reply.request_sha256 = "0".repeat(64); return reply; },
    async readPromptOriginal(_workspace, sessionID, id) {
      calls.push(["read-original"]);
      if (state.absentOriginal) return null;
      const seal = persisted().prompts.find(item => JSON.parse(item.wire).request_id === id), request = JSON.parse(seal.wire);
      const admission = state.originalAdmission ?? receipts.get(id).result.admission;
      return { request_id: id, session_id: sessionID, message_id: "msg-actual-receipt", request_sha256: state.badHash ? "0".repeat(64) : seal.sha256,
        admission, state: admission === "uncertain" ? "unknown" : admission,
        original: { request, operation_request_sha256: seal.sha256, engine_revision: 1, engine_instance_id: "original-engine", engine_project_id: "real-engine-project",
          session: { id: sessionID, location: { directory: workspace.workspace.root_path } }, model: {}, effective_text_sha256: await sha256(request.operation.text), files: [], skill_ids: [], memory: null, require_idle: false } };
    },
  };
  const controller = () => new LocalChatController({ identity: actual, flowID: flow, store, transport,
    current: () => state.current, uuid: () => "00000000-0000-4000-8000-" + String(++state.counter).padStart(12, "0") });
  return { memory, calls, state, store, transport, controller, persisted };
}
const effects = f => f.calls.filter(([kind]) => ["create", "session_create", "agent_turn"].includes(kind));

test("initial restore keeps composer unavailable until the retained draft is actually loaded", async () => {
  const f = fixture(), original = f.controller(); await original.setDraft("Already retained draft", "build");
  const reopened = f.controller(), restoring = reopened.restore();
  assert.equal(reopened.getSnapshot().loaded, false);
  await restoring;
  assert.equal(reopened.getSnapshot().loaded, true);
  assert.equal(reopened.getSnapshot().journal.draft, "Already retained draft");
  assert.equal(effects(f).length, 0);
});
test("first Send fences every effect durably and submits captured Unicode bytes once", async () => {
  const f = fixture(), c = f.controller(); await c.restore();
  const original = " Preserve CRLF\r\n日本語 😀  ";
  await c.setDraft(original, "build"); await c.send();
  assert.deepEqual(effects(f).map(([kind]) => kind), ["create", "session_create", "agent_turn"]);
  assert.equal(effects(f)[2][1].operation.text, original);
  assert.equal(c.getSnapshot().journal.draft, "");
  assert.equal(c.getSnapshot().journal.prompts[0].phase, "committed");
});
test("lost workspace acknowledgement survives restore; Check only reads and never continues", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Keep first original", "build");
  f.state.lose = "create"; await assert.rejects(c.send(), /lost create/);
  const reopened = f.controller(); await reopened.restore();
  await assert.rejects(reopened.send(), /Check the original/);
  await reopened.checkOriginals();
  assert.deepEqual(effects(f).map(([kind]) => kind), ["create"]);
  assert.equal(reopened.getSnapshot().journal.draft, "Keep first original");
  f.state.lose = ""; await reopened.send();
  assert.deepEqual(effects(f).map(([kind]) => kind), ["create", "session_create", "agent_turn"]);
});
test("lost session and prompt acknowledgements never replay; exact receipts recover read-only", async () => {
  for (const kind of ["session_create", "agent_turn"]) {
    const f = fixture(), c = f.controller(); await c.setDraft("Captured original " + kind, "build"); f.state.lose = kind;
    await assert.rejects(c.send(), /lost operation/); const before = effects(f).length;
    const restored = f.controller(); await restored.restore(); await restored.checkOriginals();
    assert.equal(effects(f).length, before);
    assert.equal(restored.getSnapshot().journal.draft, kind === "agent_turn" ? "" : "Captured original " + kind);
  }
});
test("committed operation with uncertain prompt admission remains locked without replay", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Never repeat unknown", "build"); f.state.lose = "uncertain";
  await assert.rejects(c.send(), /uncertain/); await assert.rejects(c.checkOriginals(), /uncertain/);
  await assert.rejects(c.send(), /Check the original/);
  assert.equal(effects(f).filter(([kind]) => kind === "agent_turn").length, 1);
  assert.equal(c.getSnapshot().journal.draft, "Never repeat unknown");
});
test("storage failure before the dispatch fence makes no allocation", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Retain on quota failure", "build");
  f.state.fail = raw => JSON.parse(raw).workspace?.seal.phase === "unknown";
  await assert.rejects(c.send(), /storage denied/); assert.equal(effects(f).length, 0);
  assert.equal(c.getSnapshot().journal.workspace.seal.phase, "reserved");
});
test("receipt owner/hash mismatch keeps original unknown and never resubmits", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Preserve exact hash", "build"); f.state.lose = "agent_turn";
  await assert.rejects(c.send()); f.state.badHash = true;
  await assert.rejects(c.checkOriginals(), /exact original/);
  assert.equal(c.getSnapshot().journal.prompts[0].phase, "unknown");
  assert.equal(effects(f).filter(([kind]) => kind === "agent_turn").length, 1);
});
test("changed scope after create acknowledgement retains result but sends no session or prompt", async () => {
  const f = fixture(), original = f.transport.createWorkspace;
  f.transport.createWorkspace = async body => { const reply = await original(body); f.state.current = false; return reply; };
  const c = f.controller(); await c.setDraft("Do not redirect a new selection", "build");
  await assert.rejects(c.send(), /view changed/); assert.equal(effects(f).length, 1);
  assert.equal(c.getSnapshot().journal.workspace.seal.phase, "committed");
});
test("corrupt saved originals and missing agent refuse before any effect", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("text", "");
  await assert.rejects(c.send(), /primary agent/); assert.equal(effects(f).length, 0);
  const key = c.key; f.memory.set(key, "{corrupt");
  await assert.rejects(f.controller().restore(), /unreadable/); assert.equal(f.memory.get(key), "{corrupt");
});
test("closed transport rejects Project/account/URL substitution and requires real locks", async () => {
  const calls = [], rpc = createLocalTransport({ workbench: (...args) => calls.push(args) });
  assert.throws(() => rpc.readWorkspace("https://another-owner"), /original ID/);
  assert.throws(() => rpc.dispatch({ request_id: flow, owner: { ...actual, workspace_id: flow, revision: 0, project_id: "fake" }, operation: { kind: "agent_turn", session_id: "ses_" + "a".repeat(32), text: "no" } }), /owner/);
  assert.equal(calls.length, 0);
  const store = browserOriginalStore({ getItem: () => null }, null);
  await assert.rejects(store.withLock("key", () => {}), /coordination/);
});

test("explicit workspace preparation retains draft and never invents a session or agent", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Retain before allocation", "");
  await c.prepareWorkspace();
  assert.deepEqual(effects(f).map(([kind]) => kind), ["create"]);
  assert.equal(c.getSnapshot().journal.draft, "Retain before allocation");
  await assert.rejects(c.prepareWorkspace(), /will not be allocated again/);
  await c.setDraft("Retain before allocation", "build"); await c.send();
  assert.equal(effects(f).filter(([kind]) => kind === "create").length, 1);
});
test("lost generic Stop acknowledgement retains exact control and check never replays", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Original prompt", "build"); await c.send();
  const session_id = c.getSnapshot().journal.session.observation.id;
  f.state.lose = "session_interrupt";
  await assert.rejects(c.control({ kind: "session_interrupt", session_id }), /lost operation/);
  await assert.rejects(c.control({ kind: "session_interrupt", session_id }), /Check original/);
  const restored = f.controller(); await restored.restore(); await restored.checkOriginals();
  assert.equal(f.calls.filter(([kind]) => kind === "session_interrupt").length, 1);
  assert.equal(restored.getSnapshot().journal.controls[0].receipt.result.exact_turn_guarantee, false);
});
test("actual context mapping rejects Snapshot aliases and absent environment custody", () => {
  const reply = { library_id: actual.installation_id, service_instance_id: actual.service_instance_id,
    custodian: { key: actual.custodian_key }, environments: [{ environment: { kind: "windows" }, label: "Windows", selection_source: "native_windows_custody" }], default_environment: { kind: "windows" } };
  assert.deepEqual(identityFromContext(reply, actual.environment), actual);
  assert.throws(() => identityFromContext({ ...reply, library_id: undefined, installation_id: "snapshot-alias" }, actual.environment), /ownership/);
  assert.throws(() => identityFromContext(reply, { kind: "wsl", distro: "Ubuntu", user: "actual-user" }), /environment/);
});
test("real message page keeps server order and opaque cursor; rejects foreign owner/message", async () => {
  const f = fixture(), c = f.controller(); await c.prepareWorkspace();
  const owner = c.getSnapshot().journal.workspace.observation.owner, session_id = "ses_" + "a".repeat(32);
  const page = { owner, session_id, order: "desc", cursor: { next: "opaque-next", previous: "opaque-prev" },
    data: ["msg_z", "msg_a"].map(id => ({ id, sessionID: session_id, type: "assistant", text: "<script>literal text</script>", content: [] })) };
  assert.deepEqual(messagePage(page, owner, session_id).data.map(message => message.id), ["msg_z", "msg_a"]);
  assert.throws(() => messagePage({ ...page, owner: { ...owner, revision: 1 } }, owner, session_id), /another local owner/);
  assert.throws(() => messagePage({ ...page, data: [{ ...page.data[0], sessionID: "ses_foreign" }] }, owner, session_id), /foreign message/);
  let current = true, messageReads = 0;
  const reads = { readRuntime: async () => ({ owner, ready: false }), readStatus: async () => { current = false; return { owner, session_id, running: false, terminal_observed: false }; }, readMessages: async () => { messageReads++; return page; } };
  await assert.rejects(readConversation(reads, owner, session_id, () => current), /selection changed/);
  // A changed selection cannot publish an observation; the transport also fences each read.
  assert.equal(messageReads, 0);
});
test("finite read transport encodes cursor and never accepts URL/Project query injection", () => {
  const calls = [], transport = createLocalTransport({ workbench: (...args) => calls.push(args) });
  const sid = "ses_" + "a".repeat(32);
  transport.readMessages(flow, sid, "opaque&project_id=foreign", () => true);
  assert.equal(calls[0][1], `/v1/local-workspaces/${flow}/sessions/${sid}/messages?limit=50&cursor=opaque%26project_id%3Dforeign`);
  assert.throws(() => transport.readMessages(flow, sid, "bad\nheader", () => true), /cursor/);
  assert.throws(() => transport.readRuntime("https://foreign", () => true), /original ID/);
  transport.readPromptOriginal(flow, sid, flow, () => true);
  assert.equal(calls[1][1], `/v1/local-workspaces/${flow}/sessions/${sid}/prompts/${flow}`);
  assert.throws(() => transport.readPromptOriginal(flow, sid, "https://foreign", () => true), /original ID/);
});
test("local flow selection is durable before use and survives service restart without allocation", async () => {
  const f = fixture();
  assert.deepEqual(await localFlows(f.store, actual), []);
  assert.deepEqual(await localFlows(f.store, actual, flow), [flow]);
  assert.deepEqual(await localFlows(f.store, { ...actual, service_instance_id: "new-instance" }), [flow]);
  await assert.rejects(localFlows(f.store, actual, flow), /distinct/);
  assert.equal(effects(f).length, 0);
});
test("fresh context retains one initial draft selection and reuses it without any backend allocation", async () => {
  const f = fixture(), makeID = () => flow;
  assert.deepEqual(await initialLocalFlows(f.store, actual, makeID), [flow]);
  assert.deepEqual(await initialLocalFlows(f.store, actual, () => { throw Error("must reuse original"); }), [flow]);
  assert.equal(effects(f).length, 0);
});
test("control serializers are closed and retain exact typed Rust declaration order", () => {
  const owner = { ...actual, workspace_id: flow, revision: 3 };
  for (const operation of [{ kind: "session_select_model", session_id: "ses_" + "a".repeat(32), model_id: "actual-model" },
    { kind: "session_select_agent", session_id: "ses_" + "a".repeat(32), agent: "actual-agent" }]) {
    assert.deepEqual(JSON.parse(operationWire(flow, owner, operation)).operation, operation);
    assert.throws(() => operationWire(flow, owner, { ...operation, url: "https://foreign" }), /control/);
  }
});
test("only the exact persisted original can resolve an immutable uncertain operation without replay", async () => {
  const f = fixture(), c = f.controller(); await c.setDraft("Original with CRLF\r\n😀", "build"); f.state.lose = "uncertain";
  await assert.rejects(c.send(), /uncertain/);
  f.state.originalAdmission = "admitted";
  await c.checkOriginals();
  const prompt = c.getSnapshot().journal.prompts[0];
  assert.equal(prompt.receipt.result.admission, "uncertain");
  assert.equal(prompt.original_receipt.admission, "admitted");
  assert.equal(prompt.phase, "committed"); assert.equal(c.getSnapshot().journal.draft, "");
  await f.controller().restore();
  assert.equal(effects(f).filter(([kind]) => kind === "agent_turn").length, 1);
  assert.equal(f.calls.filter(([kind]) => kind === "read-original").length, 1);
});
test("absent, rejected, or mixed original records preserve exact draft and never replay", async () => {
  for (const outcome of ["absent", "rejected", "mixed"]) {
    const f = fixture(), c = f.controller(); await c.setDraft("Preserve " + outcome, "build"); f.state.lose = "uncertain";
    await assert.rejects(c.send());
    if (outcome === "absent") f.state.absentOriginal = true;
    else if (outcome === "rejected") f.state.originalAdmission = "rejected";
    else {
      const read = f.transport.readPromptOriginal;
      f.transport.readPromptOriginal = async (...args) => { const reply = await read(...args); reply.original.request.owner.service_instance_id = "foreign-instance"; return reply; };
    }
    await assert.rejects(c.checkOriginals(), outcome === "absent" ? /Absence/ : outcome === "mixed" ? /exact original/ : /rejected/);
    assert.equal(c.getSnapshot().journal.draft, "Preserve " + outcome);
    assert.equal(c.getSnapshot().journal.prompts[0].phase, outcome === "rejected" ? "rejected" : "unknown");
    assert.equal(effects(f).filter(([kind]) => kind === "agent_turn").length, 1);
  }
});
test("server environment candidates never fabricate a Windows or default WSL user", () => {
  const actualWSL = { kind: "wsl", distro: "Recorded distro", user: "recorded-user" };
  const reply = { environments: [{ environment: actualWSL, label: "Saved WSL environment", selection_source: "recorded_project" }], default_environment: null };
  assert.equal(environmentSelections(reply).default_environment, null);
  assert.deepEqual(environmentSelections(reply).environments[0].environment, actualWSL);
  assert.throws(() => environmentSelections({ ...reply, default_environment: { kind: "windows" } }), /default/);
  assert.throws(() => environmentSelections({ environments: [{ environment: { kind: "wsl", distro: "Default" }, label: "No user", selection_source: "recorded_project" }], default_environment: null }), /environment/);
  assert.throws(() => environmentSelections({ environments: [{ ...reply.environments[0], selection_source: "native_windows_custody" }], default_environment: null }), /choice/);
  assert.deepEqual(environmentSelections({ environments: [], default_environment: null }), { environments: [], default_environment: null });
});
