import type {Readable,Writable} from "node:stream";
import type {spawn} from "node:child_process";
export function runOriginalCandidateBootstrap(options:{binding:unknown;validateOriginalProtectedDeployment():unknown|Promise<unknown>;verifierFactory():{accept(value:Uint8Array):void;finish():{verified:boolean}};environment?:NodeJS.ProcessEnv;stdin?:Readable;stdout?:Writable;spawn?:typeof spawn}):Promise<number>;
export function assertCandidateBootstrapAssignment(value:unknown,binding:unknown,environment:NodeJS.ProcessEnv):unknown;
export function assertCandidateExecutionAssignment(value:unknown,expected:unknown,binding:unknown):unknown;
