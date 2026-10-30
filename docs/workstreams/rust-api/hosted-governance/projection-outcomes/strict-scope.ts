/** Synchronous opt-in scope owned by the original skill projection module. */
export interface SkillProjectionWitness {
  phase: "attempt" | "completed" | "failed";
  action: "write" | "remove" | "mkdir" | "validate";
  projectId: string; skillId: string | null; name: string; revision: number | null;
  relativePath: string; code?: string; expectedSha256?: string;
}
export type SkillProjectionObserver = (event: Readonly<SkillProjectionWitness>) => void;
let strictProjectionObserver: SkillProjectionObserver | undefined;
export class SkillProjectionFailure extends Error {
  constructor(public readonly witness: Readonly<SkillProjectionWitness>) {
    super("Skill projection did not complete: " + (witness.code ?? "PROJECTION_FAILED"));
    this.name = "SkillProjectionFailure";
  }
}
/** Observer validates the admission plan and captures bounded memory events; never writes SQL here. */
export function withStrictSkillProjection<T>(observer: SkillProjectionObserver, work: () => T): T {
  if (typeof observer !== "function" || strictProjectionObserver) throw new Error("Exclusive synchronous projection observer required");
  if (work.constructor.name === "AsyncFunction") throw new Error("Asynchronous skill projection is forbidden");
  strictProjectionObserver = observer;
  try {
    const result = work();
    if (result && typeof (result as {then?: unknown}).then === "function") throw new Error("Asynchronous skill projection is forbidden");
    return result;
  } finally { strictProjectionObserver = undefined; }
}
function projectionEvent(skill: Partial<Skill> & {name: string}, action: SkillProjectionWitness["action"], relativePath: string, phase: SkillProjectionWitness["phase"], code?: string): SkillProjectionWitness {
  return {phase,action,projectId:skill.project_id ?? "",skillId:skill.id ?? null,name:skill.name,
    revision:typeof skill.revision === "number" ? skill.revision : null,relativePath,...(code?{code}:{})};
}
function projectionRefused(skill: Partial<Skill> & {name:string}, code: string, relativePath = ""): void {
  if (!strictProjectionObserver) return;
  const event = projectionEvent(skill,"validate",relativePath,"failed",code);
  strictProjectionObserver(Object.freeze(event));
  throw new SkillProjectionFailure(event);
}
function projectionIo<T>(skill: Partial<Skill> & {name:string}, action: SkillProjectionWitness["action"], relativePath: string, work: () => T, expectedSha256?: string): T {
  if (!strictProjectionObserver) return work();
  const observer = strictProjectionObserver;
  const eventAt = (phase: SkillProjectionWitness["phase"], code?: string) => ({...projectionEvent(skill,action,relativePath,phase,code),...(expectedSha256?{expectedSha256}:{})});
  observer(Object.freeze(eventAt("attempt")));
  try {
    const result = work();
    observer(Object.freeze(eventAt("completed")));
    return result;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      && /^[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : "PROJECTION_IO_FAILED";
    const event = eventAt("failed",code);
    try { observer(Object.freeze(event)); } catch { /* Attempt is already durable; preserve failure. */ }
    throw new SkillProjectionFailure(event);
  }
}
