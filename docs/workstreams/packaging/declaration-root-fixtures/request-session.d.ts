import type { Request } from "express";
import { type CoreDotOptions } from "./core-binding.js";
import { type DotRequestAuthorities, type DotRequestSelection, type QualifiedDotRequestRunner } from "./request-binding.js";
export type DotQualifiedRunnerOwner = Omit<QualifiedDotRequestRunner, "executeJobRun" | "killRunProcess"> & {
    requireCapabilities: DotRequestAuthorities["requireCapabilities"];
};
/** Root supplies qualified placement/capability/settlement facts; all other adapters use existing owners. */
export declare function createCoreRequestDotBinding(request: Request, selected: DotRequestSelection, runner: DotQualifiedRunnerOwner): {
    context: () => import("./router.js").DotRequestContext;
    authorization: import("../../../../packages/veyra-automation/contracts.js").Authorization;
    bindingPolicy: import("./core-binding.js").CoreDotBindingPolicy;
    jobs: import("./service.js").JobAuthority;
    execution: import("./core-binding.js").CoreDotExecution;
    queue: import("./router.js").DotQueueReader;
};
/** HTTP-only session. Never retain its request identity for the autonomous scheduler. */
export declare function createCoreRequestDotSession(request: Request, selected: DotRequestSelection, runner: DotQualifiedRunnerOwner, options: CoreDotOptions): {
    service: import("./service.js").DotService;
    context: import("./router.js").DotRequestContext;
    queue: import("./router.js").DotQueueReader;
    asyncCancel: ((actor: import("../../../../packages/veyra-automation/contracts.js").Actor, scope: import("../../../../packages/veyra-automation/contracts.js").DotScope, id: string, revision: number) => Promise<void>) | undefined;
};
//# sourceMappingURL=request-session.d.ts.map