/**
 * Safe boundary for errors originating with OAuth, IMAP, SMTP, and provider APIs.
 *
 * Provider libraries commonly include request URLs, response bodies, headers, and
 * occasionally credentials in their errors. Those values must never cross into a
 * response, durable diagnostic, or log entry. Keep only a stable error code and a
 * user-actionable, provider-agnostic message.
 */

export type ProviderOperation = "oauth" | "imap" | "smtp" | "sync" | "api";

export type ProviderErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_UNSUPPORTED"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_REJECTED"
  | "CREDENTIALS_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "PROVIDER_ERROR";

const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTH_REQUIRED: "Email credentials are unavailable. Reconnect the account and try again.",
  AUTH_FAILED: "The email provider rejected the credentials. Reconnect the account and try again.",
  OAUTH_STATE_INVALID: "OAuth authorization could not be verified. Start the connection again.",
  OAUTH_UNSUPPORTED: "OAuth is not supported for this email provider.",
  RATE_LIMITED: "The email provider is rate limiting requests. Try again shortly.",
  PROVIDER_TIMEOUT: "The email provider did not respond in time. Try again shortly.",
  PROVIDER_UNAVAILABLE: "The email provider is temporarily unavailable. Try again later.",
  PROVIDER_NOT_FOUND: "The requested email resource is no longer available.",
  PROVIDER_REJECTED: "The email provider rejected the request.",
  CREDENTIALS_UNAVAILABLE: "Email credentials are unavailable. Update the account credentials and try again.",
  CONFIGURATION_ERROR: "Email provider configuration is unavailable. Update the account configuration and try again.",
  PROVIDER_ERROR: "The email operation could not be completed. Try again later.",
};

const PROVIDER_ERROR_CODES = new Set<ProviderErrorCode>(Object.keys(SAFE_MESSAGES) as ProviderErrorCode[]);

export interface ProviderErrorDiagnostic {
  operation: ProviderOperation;
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
}

export class ProviderOperationError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly operation: ProviderOperation,
    public readonly retryable: boolean,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "ProviderOperationError";
  }
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  return typeof error === "string" ? error.toLowerCase() : "";
}

function statusFrom(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

function classify(error: unknown): ProviderErrorCode {
  if (error instanceof ProviderOperationError) return error.code;

  const message = rawMessage(error);
  const status = statusFrom(error);
  // First-match ordering keeps specific OAuth and credential errors from being
  // shadowed by broader status or text matches.
  if (message.includes("oauth state") || message.includes("csrf")) return "OAUTH_STATE_INVALID";
  if ((message.includes("unsupported") || /not\s+(?:\w+\s+)?supported/.test(message))
    && message.includes("oauth")) return "OAUTH_UNSUPPORTED";
  if (message.includes("encryption") || message.includes("credential") || message.includes("no stored oauth")) {
    return "CREDENTIALS_UNAVAILABLE";
  }
  if (status === 401 || status === 403 || /\b401\b|\b403\b|unauthori[sz]ed|invalid[_ -]?(grant|token|credential)|authentication failed|xoauth2/.test(message)) {
    return "AUTH_FAILED";
  }
  if (status === 404 || /\b404\b|not found/.test(message)) return "PROVIDER_NOT_FOUND";
  if (status === 408 || status === 504 || /timeout|timed out|aborterror/.test(message)) return "PROVIDER_TIMEOUT";
  if (status === 429 || /\b429\b|rate limit|too many requests/.test(message)) return "RATE_LIMITED";
  if (status === 400 || status === 409 || status === 422 || /bad request|invalid request|rejected/.test(message)) {
    return "PROVIDER_REJECTED";
  }
  if (status === 502 || status === 503 || /econnreset|econnrefused|enotfound|network|temporar(?:y|ily) unavailable|service unavailable/.test(message)) {
    return "PROVIDER_UNAVAILABLE";
  }
  if (/missing.*(password|token)|no .*password|no access token/.test(message)) return "AUTH_REQUIRED";
  if (/configuration|client id|client secret/.test(message)) return "CONFIGURATION_ERROR";
  return "PROVIDER_ERROR";
}

function isRetryable(code: ProviderErrorCode): boolean {
  return code === "RATE_LIMITED"
    || code === "PROVIDER_TIMEOUT"
    || code === "PROVIDER_UNAVAILABLE"
    || code === "PROVIDER_ERROR";
}

/**
 * Convert an untrusted provider error to the only error representation that may
 * be logged or returned. Raw error text is inspected only for classification and
 * is deliberately not retained as a cause or diagnostic field.
 */
export function sanitizeProviderError(
  error: unknown,
  operation: ProviderOperation,
): ProviderOperationError {
  if (error instanceof ProviderOperationError) return error;
  // Module reloads and bundled package boundaries can break `instanceof` even
  // for an error this module created. Accept only a known code, then rebuild a
  // fresh safe error instead of copying any untrusted message or stack.
  if (error && typeof error === "object" && "code" in error) {
    const candidate = error as { code?: unknown; operation?: unknown; retryable?: unknown };
    if (typeof candidate.code === "string" && PROVIDER_ERROR_CODES.has(candidate.code as ProviderErrorCode)) {
      const source = typeof candidate.operation === "string"
        && ["oauth", "imap", "smtp", "sync", "api"].includes(candidate.operation)
        ? candidate.operation as ProviderOperation
        : operation;
      const code = candidate.code as ProviderErrorCode;
      return new ProviderOperationError(code, source, typeof candidate.retryable === "boolean"
        ? candidate.retryable
        : isRetryable(code));
    }
  }
  const code = classify(error);
  return new ProviderOperationError(code, operation, isRetryable(code));
}

/** Return structured diagnostics that are explicitly safe for logs and telemetry. */
export function providerErrorDiagnostic(
  error: unknown,
  operation: ProviderOperation,
): ProviderErrorDiagnostic {
  const safe = sanitizeProviderError(error, operation);
  return {
    operation,
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable,
  };
}

/** Safe public response fields. Never return a provider library message directly. */
export function providerErrorResponse(
  error: unknown,
  operation: ProviderOperation,
): { code: ProviderErrorCode; message: string } {
  const safe = sanitizeProviderError(error, operation);
  return { code: safe.code, message: safe.message };
}

export function isAuthenticationProviderError(error: unknown, operation: ProviderOperation): boolean {
  const code = sanitizeProviderError(error, operation).code;
  return code === "AUTH_REQUIRED" || code === "AUTH_FAILED" || code === "CREDENTIALS_UNAVAILABLE";
}
