import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authentication, authorization, getDb, invitations, mcpCredentials, oidcAuthentication, runtimes, securityAudit, securityTokens } from "ingenium-core";
import { AppError } from "../middleware/errors.js";
import { authAttemptRateLimit } from "../middleware/auth-rate-limit.js";
import { issuePreAuthCsrf, preAuthCsrf } from "../middleware/pre-auth-csrf.js";

export const authPreflightRouter = Router();

const LoginSchema = z.object({ email: z.string().max(320), password: z.string().max(1024), deviceLabel: z.string().max(128).optional() }).strict();
const TokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();
const PasswordSchema = TokenSchema.extend({ password: z.string().min(12).max(1024) }).strict();
const OIDC_TRANSACTION_COOKIE = "__Host-ingenium_oidc_transaction";

function setSession(res: Response, session: ReturnType<typeof authentication.createSession>): void {
  res.set("Set-Cookie", `${authentication.SESSION_COOKIE_NAME}=${session.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200`);
}

function currentUser(req: Request) {
  if (req.principal?.type !== "user" || !req.principal.session) throw new AppError("Browser authentication is required", "UNAUTHORIZED", 401);
  return req.principal;
}

function cookie(req: Request, name: string): string | undefined {
  return req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function requireRecentStepUp(req: Request) {
  const principal = currentUser(req);
  if (!authentication.hasRecentStepUp(principal.session!)) {
    throw new AppError("Recent authentication is required", "STEP_UP_REQUIRED", 403);
  }
  return principal;
}

authPreflightRouter.get("/csrf", issuePreAuthCsrf);
authPreflightRouter.post("/fixture-session", (req, res) => {
  const expectedNonce = process.env.INGENIUM_TEST_RUN_NONCE;
  const validFixtureRequest = process.env.INGENIUM_API_TEST_MODE === "1"
    && typeof expectedNonce === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedNonce)
    && req.get("x-ingenium-fixture-run-nonce") === expectedNonce
    && req.get("x-ingenium-internal-service") === "1"
    && req.principal?.type === "compatibility"
    && req.headers.cookie === undefined
    && req.get("origin") === undefined;
  if (!validFixtureRequest) throw new AppError("Resource not found", "NOT_FOUND", 404);

  const owner = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT owner_user_id AS userId FROM bootstrap_state WHERE singleton = 1 AND state = 'claimed'",
  ).get() as { userId: string } | undefined;
  if (!owner) throw new AppError("Fixture owner is not provisioned", "FIXTURE_NOT_READY", 409);

  const session = authentication.createSession(owner.userId, new Date(), "QA Vision fixture");
  setSession(res, session);
  res.set("Cache-Control", "no-store");
  res.json({ data: { authenticated: true } });
});
authPreflightRouter.get("/oidc/providers", (_req, res) => {
  res.json({
    data: oidcAuthentication.listOidcProviders()
      .filter((provider) => Boolean(provider.enabled))
      .map(({ id, name }) => ({ id, name })),
  });
});

authPreflightRouter.post("/login", preAuthCsrf, authAttemptRateLimit, async (req, res, next) => {
  try {
    const input = LoginSchema.parse(req.body);
    const user = await authentication.authenticateLocal(input.email, input.password);
    if (authentication.hasTotp(user.id)) {
      const challengeToken = authentication.issueOneTimeState("mfa_challenge", user.id, authentication.AUTH_CHALLENGE_MS, { deviceLabel: input.deviceLabel ?? "Browser" });
      res.status(202).json({ data: { mfaRequired: true, challengeToken } });
      return;
    }
    const session = authentication.createSession(user.id, new Date(), input.deviceLabel);
    setSession(res, session);
    securityAudit.appendSecurityAuditEvent({ actorType: "user", actorId: user.id, action: "auth.login", outcome: "success" });
    res.json({ data: { user: authentication.getUserForSession(session.session), csrfToken: session.csrfToken } });
  } catch (error) {
    if (error instanceof authentication.AuthenticationError) next(new AppError("Authentication failed", "AUTHENTICATION_FAILED", 401));
    else next(error);
  }
});

authPreflightRouter.post("/mfa/challenge", preAuthCsrf, authAttemptRateLimit, (req, res, next) => {
  try {
    const input = z.object({ challengeToken: z.string().min(32).max(512), code: z.string().min(6).max(128) }).strict().parse(req.body);
    const challenge = authentication.consumeOneTimeState(input.challengeToken, "mfa_challenge");
    if (!authentication.verifySecondFactor(challenge.userId, input.code)) throw new authentication.AuthenticationError();
    const session = authentication.createSession(challenge.userId, new Date(), challenge.metadata.deviceLabel, true);
    setSession(res, session);
    res.json({ data: { user: authentication.getUserForSession(session.session), csrfToken: session.csrfToken } });
  } catch (error) { next(error instanceof authentication.AuthenticationError ? new AppError("Authentication failed", "AUTHENTICATION_FAILED", 401) : error); }
});

authPreflightRouter.get("/session", (req, res) => {
  const principal = currentUser(req);
  res.json({ data: {
    user: authentication.getUserForSession(principal.session!),
    session: {
      id: principal.session!.id,
      recentStepUp: authentication.hasRecentStepUp(principal.session!),
      mfaEnabled: authentication.hasTotp(principal.id),
    },
    installationAdmin: authorization.isInstallationAdmin(principal.id),
  } });
});
authPreflightRouter.post("/session/csrf", (req, res) => {
  currentUser(req);
  const token = cookie(req, authentication.SESSION_COOKIE_NAME);
  const rotated = token ? authentication.rotateSession(token) : undefined;
  if (!rotated) throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
  setSession(res, rotated);
  res.set("Cache-Control", "no-store");
  res.json({ data: { csrfToken: rotated.csrfToken } });
});

authPreflightRouter.post("/session/refresh", (req, res) => {
  currentUser(req);
  const token = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${authentication.SESSION_COOKIE_NAME}=`))?.split("=")[1];
  const rotated = token ? authentication.rotateSession(token) : undefined;
  if (!rotated) throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
  setSession(res, rotated);
  res.json({ data: { csrfToken: rotated.csrfToken } });
});

authPreflightRouter.post("/logout", (req, res) => {
  const principal = currentUser(req);
  runtimes.revokeRuntimeBrowserSessionsForUser(principal.id);
  authentication.revokeSession(principal.id, principal.session!.id);
  res.set("Set-Cookie", `${authentication.SESSION_COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.status(204).end();
});

authPreflightRouter.get("/sessions", (req, res) => res.json({ data: authentication.listSessions(currentUser(req).id) }));
authPreflightRouter.post("/sessions/revoke-others", (req, res) => {
  const principal = requireRecentStepUp(req);
  res.json({ data: { revoked: authentication.revokeAllUserSessions(principal.id, principal.session!.id) } });
});
authPreflightRouter.delete("/sessions/:id", (req, res) => {
  if (!authentication.revokeSession(requireRecentStepUp(req).id, req.params.id)) throw new AppError("Session not found", "NOT_FOUND", 404);
  res.status(204).end();
});

authPreflightRouter.post("/step-up", async (req, res, next) => {
  try {
    const principal = currentUser(req);
    const input = z.object({ credential: z.string().min(6).max(1024) }).strict().parse(req.body);
    const verified = authentication.hasTotp(principal.id)
      ? Boolean(authentication.verifySecondFactor(principal.id, input.credential))
      : await authentication.verifyUserPassword(principal.id, input.credential);
    if (!verified) throw new authentication.AuthenticationError();
    const token = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${authentication.SESSION_COOKIE_NAME}=`))?.split("=")[1];
    const rotated = token ? authentication.rotateSession(token, new Date(), true) : undefined;
    if (!rotated) throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
    setSession(res, rotated);
    res.json({ data: { csrfToken: rotated.csrfToken, recentStepUp: true } });
  } catch (error) { next(error instanceof authentication.AuthenticationError ? new AppError("Authentication failed", "AUTHENTICATION_FAILED", 401) : error); }
});

authPreflightRouter.post("/password/forgot", preAuthCsrf, authAttemptRateLimit, async (req, res, next) => {
  try {
  const email = z.object({ email: z.string().max(320) }).strict().parse(req.body).email;
  const token = await authentication.issuePasswordReset(email);
  res.json({ data: { accepted: true, ...(process.env.NODE_ENV === "test" && token ? { testToken: token } : {}) } });
  } catch (error) { next(error); }
});
authPreflightRouter.post("/password/reset", preAuthCsrf, authAttemptRateLimit, async (req, res, next) => {
  try { await authentication.resetPassword(PasswordSchema.parse(req.body).token, PasswordSchema.parse(req.body).password); res.status(204).end(); } catch (error) { next(error); }
});
authPreflightRouter.post("/password/change", async (req, res, next) => {
  try {
    const input = z.object({ currentPassword: z.string().max(1024), password: z.string().min(12).max(1024) }).strict().parse(req.body);
    const userId = requireRecentStepUp(req).id;
    await authentication.changePassword(userId, input.currentPassword, input.password);
    const session = authentication.createSession(userId, new Date(), undefined, true);
    setSession(res, session);
    res.json({ data: { csrfToken: session.csrfToken } });
  } catch (error) { next(error); }
});

authPreflightRouter.post("/email/resend", (req, res) => {
  const token = authentication.issueEmailVerification(currentUser(req).id);
  res.json({ data: { accepted: true, ...(process.env.NODE_ENV === "test" ? { testToken: token } : {}) } });
});
authPreflightRouter.post("/email/verify", preAuthCsrf, (req, res) => { authentication.verifyEmail(TokenSchema.parse(req.body).token); res.status(204).end(); });

authPreflightRouter.get("/invitations/preview", (req, res) => {
  const preview = invitations.previewInvitation(String(req.query.token ?? ""));
  if (!preview) throw new AppError("Invitation is invalid or expired", "INVALID_INVITATION", 404);
  res.json({ data: preview });
});
authPreflightRouter.post("/invitations/accept", (req, res) => { invitations.acceptInvitation(TokenSchema.parse(req.body).token, currentUser(req).id); res.status(204).end(); });

authPreflightRouter.post("/totp/enroll", (req, res) => res.status(201).json({ data: authentication.beginTotpEnrollment(requireRecentStepUp(req).id) }));
authPreflightRouter.post("/totp/confirm", (req, res) => {
  const input = z.object({ factorId: z.string().uuid(), code: z.string().length(6) }).strict().parse(req.body);
  const userId = requireRecentStepUp(req).id;
  const recoveryCodes = authentication.confirmTotpEnrollment(userId, input.factorId, input.code);
  const session = authentication.createSession(userId, new Date(), undefined, true);
  setSession(res, session);
  res.json({ data: { recoveryCodes, csrfToken: session.csrfToken } });
});
authPreflightRouter.delete("/totp", (req, res) => {
  const userId = requireRecentStepUp(req).id;
  authentication.removeTotp(userId, z.object({ code: z.string().min(6).max(128) }).parse(req.body).code);
  const session = authentication.createSession(userId, new Date(), undefined, true);
  setSession(res, session);
  res.json({ data: { csrfToken: session.csrfToken } });
});

authPreflightRouter.get("/tokens", (req, res) => res.json({ data: securityTokens.listUserApiTokens(currentUser(req).id) }));
authPreflightRouter.post("/tokens", (req, res) => {
  const input = z.object({ name: z.string().min(1).max(128), scopes: z.array(z.string()).min(1).max(64), expiresAt: z.string().datetime(), organizationId: z.string().uuid().optional(), projectId: z.string().uuid().optional() }).strict().parse(req.body);
  const token = securityTokens.createScopedApiToken({ userId: requireRecentStepUp(req).id }, input.scopes, new Date(input.expiresAt), input);
  res.status(201).location(`/api/v1/auth/tokens/${token.id}`).json({ data: token });
});
authPreflightRouter.delete("/tokens/:id", (req, res) => {
  if (!securityTokens.revokeScopedApiToken(req.params.id, requireRecentStepUp(req).id)) throw new AppError("API token not found", "NOT_FOUND", 404);
  res.status(204).end();
});

const McpCredentialSchema = z.object({
  servicePrincipalId: z.string().uuid().optional(),
  kind: z.enum(["service", "runtime", "repository-sync"]),
  audience: z.enum(["mcp", "runtime", "repository-sync"]),
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).min(1).max(64),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectIds: z.array(z.string().uuid()).min(1).max(32).optional(),
  workspaceId: z.string().min(1).max(256),
  launcherWorktree: z.string().min(1).max(1024),
  expiresAt: z.string().datetime(),
}).strict();

authPreflightRouter.get("/mcp-credentials", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: mcpCredentials.listMcpCredentials(currentUser(req).id) });
});
authPreflightRouter.post("/mcp-credentials", (req, res) => {
  const principal = requireRecentStepUp(req);
  const input = McpCredentialSchema.parse(req.body);
  const decision = authorization.requireOrganizationPermission({
    type: "browser-user",
    id: principal.id,
    scopes: principal.scopes,
  }, input.organizationId, "credentials", "admin");
  if (!decision.allowed) {
    throw new AppError(decision.visible ? "The authenticated principal cannot perform this action" : "Resource not found",
      decision.visible ? "FORBIDDEN" : "NOT_FOUND", decision.visible ? 403 : 404);
  }
  let credential: ReturnType<typeof mcpCredentials.createMcpCredential>;
  try {
    credential = mcpCredentials.createMcpCredential({
      ...input,
      servicePrincipalName: `MCP ${input.name}`.slice(0, 128),
      expiresAt: new Date(input.expiresAt),
      createdByUserId: principal.id,
    });
  } catch {
    throw new AppError("Credential request is invalid", "VALIDATION_ERROR", 422);
  }
  res.set("Cache-Control", "no-store");
  res.status(201).location(`/api/v1/auth/mcp-credentials/${credential.id}`).json({ data: credential });
});
authPreflightRouter.post("/mcp-credentials/:id/rotate", (req, res) => {
  const principal = requireRecentStepUp(req);
  const input = z.object({ expiresAt: z.string().datetime().optional() }).strict().parse(req.body);
  let credential: ReturnType<typeof mcpCredentials.rotateMcpCredential>;
  try {
    credential = mcpCredentials.rotateMcpCredential(req.params.id, principal.id, input.expiresAt ? new Date(input.expiresAt) : undefined);
  } catch (error) {
    if (error instanceof Error && error.message === "Credential not found") throw new AppError("Credential not found", "NOT_FOUND", 404);
    throw new AppError("Credential request is invalid", "VALIDATION_ERROR", 422);
  }
  res.set("Cache-Control", "no-store");
  res.status(201).json({ data: credential });
});
authPreflightRouter.delete("/mcp-credentials/:id", (req, res) => {
  if (!mcpCredentials.revokeMcpCredential(req.params.id, requireRecentStepUp(req).id)) {
    throw new AppError("Credential not found", "NOT_FOUND", 404);
  }
  res.status(204).end();
});

authPreflightRouter.post("/oidc/start", preAuthCsrf, async (req, res, next) => {
  try {
    const { transactionToken, ...result } = await oidcAuthentication.beginOidcAuthorization(z.object({ providerId: z.string().uuid() }).strict().parse(req.body).providerId);
    res.set("Set-Cookie", `${OIDC_TRANSACTION_COOKIE}=${transactionToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`);
    res.json({ data: result });
  } catch (error) { next(error); }
});
authPreflightRouter.get("/oidc/callback", async (req, res, next) => {
  try {
    const input = z.object({ state: z.string().min(32).max(512), code: z.string().min(1).max(2048) }).parse(req.query);
    const transactionToken = cookie(req, OIDC_TRANSACTION_COOKIE);
    if (!transactionToken) throw new AppError("OIDC authorization failed", "OIDC_AUTHENTICATION_FAILED", 401);
    res.set("Set-Cookie", `${OIDC_TRANSACTION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
    const session = authentication.createSession(await oidcAuthentication.completeOidcAuthorization(input.state, input.code, transactionToken), new Date(), undefined, true);
    setSession(res, session);
    res.json({ data: { user: authentication.getUserForSession(session.session), csrfToken: session.csrfToken } });
  } catch (error) { next(error); }
});

authPreflightRouter.get("/preflight", (req, res) => {
  if (req.principal?.type === "user" && !req.principal.session
    && !req.principal.scopes.includes("auth:preflight") && !req.principal.scopes.includes("auth:*")) {
    throw new AppError("The authenticated principal cannot perform this action", "FORBIDDEN", 403);
  }
  if (req.principal?.type === "service" && !req.principal.scopes.includes("projects:read")
    && !req.principal.scopes.includes("projects:*") && !req.principal.scopes.includes("*")) {
    throw new AppError("The authenticated principal cannot perform this action", "FORBIDDEN", 403);
  }
  const principal = req.principal;
  res.set("Cache-Control", "no-store");
  res.json({ data: {
    authenticated: true,
    ...(principal?.type === "service" ? {
      principal: { type: principal.type, id: principal.id },
      scopes: principal.scopes,
      organizationId: principal.organizationId,
      projectId: principal.projectId,
      projectIds: principal.projectIds ?? (principal.projectId ? [principal.projectId] : []),
      audience: principal.audience,
      workspaceId: principal.workspaceId,
      launcherWorktree: principal.launcherWorktree,
      restartRequiredOnCredentialChange: true,
    } : {}),
  } });
});
