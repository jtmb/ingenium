import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { AppError } from "./errors.js";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      throw new AppError(
        "Input validation failed",
        "VALIDATION_ERROR",
        422,
        result.error.errors.map((e) => ({
          field: e.path.join("."),
          reason: e.message,
        })),
      );
    }
    req[source] = result.data;
    next();
  };
}
