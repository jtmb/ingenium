import { Request, Response, NextFunction } from "express";
/** Reset the rate-limit store entirely — exposed for test cleanup only. */
export declare function clearRateLimitEntries(): void;
export declare function rateLimit(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=rate-limit.d.ts.map