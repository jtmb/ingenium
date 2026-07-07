import { Request, Response, NextFunction } from "express";
import { AppError } from "./errors.js";

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = process.env.INGENIUM_API_TOKEN;

  if (!token) {
    // No token configured — skip auth
    next();
    return;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Missing or invalid authorization header", "UNAUTHORIZED", 401);
  }

  const provided = authHeader.slice(7);
  if (provided !== token) {
    throw new AppError("Invalid authorization token", "FORBIDDEN", 403);
  }

  next();
}
