import type { Skill } from "./contracts";

export interface SkillWriteFailure {
  status: number | null; code: string | null; message: string; original: unknown; outcome: "refused" | "unknown";
}
export interface SkillWriteAttempt {
  project: string; name: string; description?: string; content?: string;
  id?: string; projectId?: string; path?: string; text?: string;
}
export interface SkillWriteResult {
  status: "validation-error" | "refused" | "unknown" | "saved-refresh-failed" | "success" | "verified" | "conflict" | "read-error";
  writeConfirmed: boolean; message: string; attempt?: SkillWriteAttempt;
  failure?: SkillWriteFailure; lastVerificationFailure?: SkillWriteFailure; record?: Skill;
}
export interface UploadValue {name: string; description: string; content: string}
export interface SkillSavePayload {content: string; extra: {tags?: string; always_apply: number; files?: string}}
export function skillWriteFailure(error: unknown): SkillWriteFailure;
export function parseSkillUpload(text: string): UploadValue | null;
export function skillWriteBlocked(result: SkillWriteResult | null): boolean;
export function skillResourcePath(name: string, project: string): string;
export function skillSavePayload(skill: Skill, path: string, text: string): SkillSavePayload;
export function runSkillUpload(text: string, project: string, ports: {
  create(value: UploadValue, project: string): Promise<unknown>; refresh(): Promise<boolean>;
}): Promise<SkillWriteResult>;
export function verifySkillUpload(previous: SkillWriteResult, ports: {
  read(name: string, project: string): Promise<Skill>; refresh(): Promise<boolean>;
}): Promise<SkillWriteResult>;
export function runSkillSave(skill: Skill, path: string, text: string, project: string, ports: {
  write(name: string, payload: SkillSavePayload, project: string): Promise<unknown>;
  read(name: string, project: string): Promise<Skill>;
}): Promise<SkillWriteResult>;
export function verifySkillSave(previous: SkillWriteResult, ports: {
  read(name: string, project: string): Promise<Skill>;
}): Promise<SkillWriteResult>;
