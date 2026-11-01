import type {Readable,Writable} from "node:stream";
import type {spawn} from "node:child_process";
import type {ResponseVerifier} from "./managed-job-contracts.mjs";
export function runOriginalCandidateBootstrap(options:{binding:unknown;validateOriginalProtectedDeployment():unknown|Promise<unknown>;verifierFactory():ResponseVerifier;environment?:NodeJS.ProcessEnv;stdin?:Readable;stdout?:Writable;spawn?:typeof spawn}):Promise<number>;
export function assertCandidateBootstrapAssignment(value:unknown,binding:unknown,environment:NodeJS.ProcessEnv):unknown;
export function assertCandidateExecutionAssignment(value:unknown,expected:unknown,binding:unknown):unknown;
