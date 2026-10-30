import type {spawn} from "node:child_process";
import type {ResponseVerifier} from "./managed-job-contracts.mjs";
export declare function runOriginalManagedJobBootstrap(ports:{validateOriginalProtectedDeployment():void|Promise<void>;verifierFactory():ResponseVerifier;environment?:NodeJS.ProcessEnv;stdin?:NodeJS.ReadableStream;spawn?:typeof spawn}):Promise<number>;
