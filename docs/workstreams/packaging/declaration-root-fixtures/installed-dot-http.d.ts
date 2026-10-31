import { type Request } from "express";
import { type DotQualifiedRunnerOwner } from "./request-session.js";
import type { DotRequestSelection } from "./request-binding.js";
/** No body-selected scope, projectless/global fallback or request-authority retention. */
export declare function selectInstalledDotRequest(request: Request): DotRequestSelection;
/** Descriptors compare original current policy; they do not grant a tool or approve an image. */
export declare function installedDotRequestRunner(request: Request, selected: DotRequestSelection): DotQualifiedRunnerOwner;
export declare function createInstalledDotRequestSession(request: Request): {
    service: import("./service.js").DotService;
    context: import("./router.js").DotRequestContext;
    queue: import("./router.js").DotQueueReader;
    asyncCancel: ((actor: import("../../../../packages/veyra-automation/contracts.js").Actor, scope: import("../../../../packages/veyra-automation/contracts.js").DotScope, id: string, revision: number) => Promise<void>) | undefined;
};
/** Mount only behind original auth, project-policy and CSRF middleware. */
export declare function createInstalledDotRouter(): import("express-serve-static-core").Router;
//# sourceMappingURL=installed-dot-http.d.ts.map