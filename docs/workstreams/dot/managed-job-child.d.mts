import type {ManagedChildPorts,ManagedJobIdentity} from "./managed-job-contracts.mjs";
export declare function createManagedJobChild(ports:ManagedChildPorts):(identity:ManagedJobIdentity)=>Promise<0|1>;
