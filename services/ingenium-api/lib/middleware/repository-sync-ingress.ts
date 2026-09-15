import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { AppError } from "./errors.js";

export const REPOSITORY_SYNC_PATH = "/api/v1/repository/sync";
export const REPOSITORY_SYNC_BODY_LIMIT = 4 * 1024 * 1024;

export function isExactRepositorySyncRequest(req: Pick<Request, "method" | "path">): boolean {
  return req.method === "POST" && req.path === REPOSITORY_SYNC_PATH;
}

export function repositorySyncContentTypeGate(req: Request, _res: Response, next: NextFunction): void {
  if (!isExactRepositorySyncRequest(req)) {
    next();
    return;
  }
  const contentType = req.get("Content-Type")?.trim();
  const contentEncoding = req.get("Content-Encoding")?.trim().toLowerCase();
  const transferEncoding = req.get("Transfer-Encoding") ?? req.get("Content-Transfer-Encoding");
  const validJson = contentType !== undefined
    && /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(contentType);
  if (!validJson || (contentEncoding !== undefined && contentEncoding !== "identity") || transferEncoding !== undefined) {
    next(new AppError("Repository synchronization requires unencoded application/json", "UNSUPPORTED_MEDIA_TYPE", 415));
    return;
  }
  next();
}

export function createRepositorySyncIngress(
  parser: RequestHandler = express.json({ limit: REPOSITORY_SYNC_BODY_LIMIT }),
): RequestHandler {
  // ponytail: one global slot bounds parser/canonicalization memory; use a keyed queue if sync throughput matters.
  let active = false;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isExactRepositorySyncRequest(req)) {
      next();
      return;
    }
    if (active) {
      res.set("Retry-After", "1");
      next(new AppError("Repository synchronization is already in progress", "RATE_LIMITED", 429));
      return;
    }

    active = true;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      active = false;
      res.off("finish", release);
      res.off("close", release);
    };
    res.once("finish", release);
    res.once("close", release);

    parser(req, res, (error?: unknown) => {
      if (error !== undefined) {
        release();
        next(error);
        return;
      }
      next();
    });
  };
}
