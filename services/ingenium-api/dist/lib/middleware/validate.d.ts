import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
/**
 * Express middleware factory that validates a request property against a Zod schema.
 *
 * Uses `safeParse` (not `parse`) to avoid Zod's own exception throwing, routing
 * all validation errors through the AppError → errorHandler pipeline for a
 * consistent JSON error shape. After successful validation, the parsed (and
 * potentially transformed) data replaces the raw input on `req[source]`, so
 * downstream handlers always work with validated, typed data.
 *
 * @param schema - Zod schema to validate against
 * @param source - Which request property to validate: "body" (default), "query", or "params"
 */
export declare function validate(schema: ZodSchema, source?: "body" | "query" | "params"): (req: Request, _res: Response, next: NextFunction) => void;
//# sourceMappingURL=validate.d.ts.map