import {runtimeWorkspaceOpenCodeContextV2} from './projects-v2/workspace-v2-opencode.mjs';
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { authorization, runtimes } from "ingenium-core";
import { isControlPlaneMode } from "./runtime-mode.js";

export interface OpenCodeRuntimeTarget {
  baseUrl: string;
  password?: string;
  authHeader?: string;
  /** Native OpenCode directory used to bind runtime requests to the workspace. */
  directory?: string;
}

const context = new AsyncLocalStorage<OpenCodeRuntimeTarget>();

export function currentOpenCodeRuntimeTarget(): OpenCodeRuntimeTarget | undefined {
  return context.getStore();
}

export function withOpenCodeRuntimeTarget<T>(target: OpenCodeRuntimeTarget, work: () => T): T {
  return context.run(target, work);
}

export function runtimeOpenCodeContext(req: Request, res: Response, next: NextFunction): void {
  if (!isControlPlaneMode()) {
    next();
    return;
  }
  const id = req.get("x-ingenium-runtime-id") ?? (typeof req.query.runtime_id === "string" ? req.query.runtime_id : "");
  const installationPath=req.path.toLowerCase().replace(/\/$/,'');
  const installationPreference=req.method==='GET'&&installationPath==='/chat-config'
    ||req.method==='PUT'&&['/chat-defaults','/chat-selection'].includes(installationPath);
  // Installation choices need no active workspace. Explicit environment requests
  // retain their original runtime scope; execution/session routes never skip it.
  if(!id&&installationPreference){next();return;}
  if(runtimeWorkspaceOpenCodeContextV2(req,res,next,id))return; // actual v2 row + fresh scope only
  const runtime = runtimes.getRuntimeInstance(id);
  if (!runtime || (runtime.state !== "READY" && runtime.state !== "IDLE") || !req.principal) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  const owner = req.principal.type === "user" && req.principal.id === runtime.ownerUserId;
  const admin = req.principal.type === "compatibility" || (req.principal.type === "user" && authorization.isInstallationAdmin(req.principal.id));
  if (!owner && !admin) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Runtime not found" } });
    return;
  }
  withOpenCodeRuntimeTarget({ baseUrl: `http://${runtime.backendName}:4098`, directory: "/workspace" }, next);
}
