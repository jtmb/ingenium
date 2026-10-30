import type {ManagedAsyncExecutionCorePorts,ManagedJobManagerClient} from "./managed-job-contracts.mjs";
import type {AsyncCoreDotExecution} from "./core-binding.js";
export declare function createManagedDotExecution(ports:{core:ManagedAsyncExecutionCorePorts;manager:ManagedJobManagerClient}):AsyncCoreDotExecution;
