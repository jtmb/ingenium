import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";
import { AppError } from "./errors.js";

const COOKIE = "__Host-ingenium_pre_auth";

function cookie(req: Request): string | undefined {
  return req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

export function issuePreAuthCsrf(_req: Request, res: Response): void {
  const token = randomBytes(32).toString("base64url");
  res.set("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);
  res.json({ data: { csrfToken: token } });
}

export function preAuthCsrf(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  const supplied = req.get("x-csrf-token") ?? "";
  const expected = cookie(req) ?? "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  const valid = suppliedBuffer.length === expectedBuffer.length && suppliedBuffer.length >= 32
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!origin || !config.dashboardOrigins.includes(origin) || !valid) {
    throw new AppError("Pre-authentication CSRF validation failed", "CSRF_REJECTED", 403);
  }
  next();
}
