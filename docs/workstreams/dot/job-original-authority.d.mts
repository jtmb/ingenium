export declare const JOB_CAPABILITY:"/run/ingenium-runtime/capability";
export declare function readOriginalJobCapability():string;
export declare function createOriginalJobAuthority(ports?:{environment?:NodeJS.ProcessEnv;readCapability?:()=>string;fetchImpl?:typeof fetch}):Readonly<{runId:string;attemptId:string;base:string;request(operation:"assignment"|"bootstrap-assignment"|"result"|"withdraw",body?:unknown):Promise<unknown>}>;
