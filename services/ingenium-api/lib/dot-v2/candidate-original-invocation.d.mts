import type {SpawnOptions} from "node:child_process";
/** Pure data producer; caller owns original production/candidate authorization. */
export function originalManagedJobInvocation(assignment:{prompt:string;agent:string;model:string},identity:{runId:string;attemptId:string},environment:NodeJS.ProcessEnv):{binary:"opencode";args:string[];options:SpawnOptions & {env:NodeJS.ProcessEnv;cwd:"/workspace";shell:false;detached:false}};
