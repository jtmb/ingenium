import { Request, Response, NextFunction } from "express";
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: unknown | undefined;
    constructor(message: string, code: string, statusCode?: number, details?: unknown | undefined);
}
export declare function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=errors.d.ts.map