import {immutableInput} from "./immutable-input.mjs";
import {createHash} from "node:crypto";
import {requireValue, scopeKey, resolveExecution, terminalDimensions, terminalInput, text}
  from "../../../../packages/veyra-projects/domain.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export class ExecutionOperations {
  constructor({db, transaction, checkpointAfterWrite, catalog, resolveAdmission, dispatch, readOperation}) {
    Object.assign(this, {db, transaction, checkpoint: checkpointAfterWrite, catalog, resolveAdmission, dispatch, readOperation});
  }
  async admission(scope, request) {
    requireValue(request && typeof request === "object" && !Array.isArray(request) &&
      Object.keys(request).every(key => ["operationId", "projectId", "binding", "action", "args"].includes(key)));
    const {operationId, projectId, binding, action, args = {}} = request;
    requireValue(text(operationId) && (projectId === null || text(projectId)));
    const capabilities = {
      "terminal.open": "terminal:open", "terminal.input": "terminal:input",
      "terminal.resize": "terminal:resize", "terminal.close": "terminal:close",
      "project.action": "projects:run", "git.status": "git:read",
      "git.diff": "git:read", "worktree.create": "worktrees:create",
      "worktree.attach": "worktrees:attach", "worktree.archive": "worktrees:archive",
      "worktree.restore": "worktrees:restore",
    };
    requireValue(typeof action === "string" && Object.hasOwn(capabilities, action));
    requireValue(args && typeof args === "object" && !Array.isArray(args));
    const argumentKeys = {
      "terminal.open": ["columns", "rows"],
      "terminal.input": ["terminalId", "data"],
      "terminal.resize": ["terminalId", "columns", "rows"],
      "terminal.close": ["terminalId"],
      "project.action": ["actionId"],
      "git.status": [],
      "git.diff": ["reviewScope", "path"],
      "worktree.create": ["repositoryId", "baseCommit", "branch", "destinationRef"],
      "worktree.attach": ["checkoutIdentity"],
      "worktree.archive": ["worktreeId", "expectedRevision", "recoveryRef"],
      "worktree.restore": ["worktreeId", "expectedRevision", "recoveryRef"],
    };
    requireValue(Object.keys(args).every(key => argumentKeys[action].includes(key)));
    if (action === "terminal.open" && (args.columns !== undefined || args.rows !== undefined))
      terminalDimensions(args.columns, args.rows);
    if (action === "git.diff") {
      requireValue(["working", "staged", "branch"].includes(args.reviewScope));
      requireValue(args.path === undefined || text(args.path));
    }
    if (action.startsWith("worktree.")) {
      requireValue(projectId !== null, "PROJECT_REQUIRED", 422);
      if (action === "worktree.create")
        requireValue(["repositoryId", "baseCommit", "branch", "destinationRef"].every(key => text(args[key])));
      if (action === "worktree.attach") requireValue(text(args.checkoutIdentity));
      if (action === "worktree.archive" || action === "worktree.restore")
        requireValue(text(args.worktreeId) && Number.isSafeInteger(args.expectedRevision) &&
          args.expectedRevision > 0 && text(args.recoveryRef));
    }
    // Admission is always refreshed by the owning host/auth service, including on receipt reads.
    const project = projectId === null ? null : await this.catalog.get(scope, projectId);
    const admission = await this.resolveAdmission(scope, {projectId, bindingId: binding?.id, action, args});
    const target = resolveExecution({scope, project, binding, admission, capability: capabilities[action]});
    if (action === "terminal.resize") terminalDimensions(args.columns, args.rows);
    if (action === "terminal.input") terminalInput(args.data);
    if (action.startsWith("terminal.") && action !== "terminal.open")
      requireValue(text(args.terminalId) && admission.terminalId === args.terminalId,
        "TERMINAL_SCOPE_MISMATCH", 403);
    if (action === "project.action")
      requireValue(text(args.actionId) && admission.actionId === args.actionId, "ACTION_NOT_FOUND", 404);
    return {operationId,projectId,binding,action,args,target};
  }
  async execute(scope, request) {
    scope=immutableInput(scope);request=immutableInput(request);
    const {operationId,projectId,action,args,target} = await this.admission(scope,request);
    const requestHash = createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
    const scoped = scopeKey(scope);
    let receipt;
    this.transaction(() => {
      receipt = this.db.prepare(`SELECT * FROM veyra_project_operations
        WHERE scope_key=? AND operation_id=?`).get(scoped, operationId);
      if (receipt) {
        requireValue(receipt.request_hash === requestHash, "OPERATION_CONFLICT", 409);
        return;
      }
      this.db.prepare(`INSERT INTO veyra_project_operations
        (scope_key,operation_id,request_hash,state) VALUES(?,?,?,'pending')`)
        .run(scoped, operationId, requestHash);
    });
    if (receipt) return {operationId, state: receipt.state,
      result: receipt.result_json === null ? null : JSON.parse(receipt.result_json)};
    this.checkpoint();
    try {
      // The transport owns PTY/Git/process effects; operationId is forwarded for its own reconciliation.
      const result = await this.dispatch({scope, projectId, binding: target, action, args, operationId});
      requireValue(result && ["succeeded", "failed", "unknown"].includes(result.state),
        "OUTCOME_UNKNOWN", 502);
      this.transaction(() => this.db.prepare(`UPDATE veyra_project_operations SET state=?,result_json=?
        WHERE scope_key=? AND operation_id=? AND state='pending'`)
        .run(result.state, JSON.stringify(result.result ?? null), scoped, operationId));
      this.checkpoint();
      return {operationId, state: result.state, result: result.result ?? null};
    } catch (error) {
      const failure = {code: error?.code === "OUTCOME_UNKNOWN" ? "INVALID_OWNER_ACKNOWLEDGEMENT" : "OWNER_RESPONSE_UNKNOWN"};
      // A transport exception cannot prove that a terminal/Git mutation did not happen.
      this.transaction(() => this.db.prepare(`UPDATE veyra_project_operations SET state='unknown',result_json=?
        WHERE scope_key=? AND operation_id=? AND state='pending'`).run(JSON.stringify(failure), scoped, operationId));
      this.checkpoint();
      return {operationId, state: "unknown", result: failure};
    }
  }
  async reconcile(scope,request) {
    scope=immutableInput(scope);request=immutableInput(request);
    const {operationId,projectId,action,args,target}=await this.admission(scope,request);
    const scoped=scopeKey(scope);
    const requestHash=createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
    const receipt=this.db.prepare(`SELECT * FROM veyra_project_operations
      WHERE scope_key=? AND operation_id=?`).get(scoped,operationId);
    requireValue(receipt,"NOT_FOUND",404);
    requireValue(receipt.request_hash===requestHash,"OPERATION_CONFLICT",409);
    if (receipt.state==="succeeded" || receipt.state==="failed") return {operationId,state:receipt.state,
      result:receipt.result_json===null ? null : JSON.parse(receipt.result_json)};
    requireValue(typeof this.readOperation==="function","RECONCILIATION_UNAVAILABLE",501);
    const observed=await this.readOperation({scope,projectId,binding:target,action,args,operationId,requestHash});
    requireValue(observed && ["pending","succeeded","failed","unknown"].includes(observed.state),
      "INVALID_OWNER_RECEIPT",502);
    if (observed.state==="succeeded" || observed.state==="failed") {
      this.transaction(()=>this.db.prepare(`UPDATE veyra_project_operations SET state=?,result_json=?
        WHERE scope_key=? AND operation_id=? AND request_hash=? AND state IN ('pending','unknown')`)
        .run(observed.state,JSON.stringify(observed.result ?? null),scoped,operationId,requestHash));
      this.checkpoint();
    }
    const current=this.db.prepare(`SELECT * FROM veyra_project_operations
      WHERE scope_key=? AND operation_id=?`).get(scoped,operationId);
    return {operationId,state:current.state,result:current.result_json===null ? null : JSON.parse(current.result_json)};
  }

}
