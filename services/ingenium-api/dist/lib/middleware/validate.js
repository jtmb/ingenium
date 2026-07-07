import { AppError } from "./errors.js";
export function validate(schema, source = "body") {
    return (req, _res, next) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) {
            throw new AppError("Input validation failed", "VALIDATION_ERROR", 422, result.error.errors.map((e) => ({
                field: e.path.join("."),
                reason: e.message,
            })));
        }
        req[source] = result.data;
        next();
    };
}
