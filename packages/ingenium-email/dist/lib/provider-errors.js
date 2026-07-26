/**
 * Safe boundary for errors originating with OAuth, IMAP, SMTP, and provider APIs.
 *
 * Provider libraries commonly include request URLs, response bodies, headers, and
 * occasionally credentials in their errors. Those values must never cross into a
 * response, durable diagnostic, or log entry. Keep only a stable error code and a
 * user-actionable, provider-agnostic message.
 */
const SAFE_MESSAGES = {
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
const PROVIDER_ERROR_CODES = new Set(Object.keys(SAFE_MESSAGES));
export class ProviderOperationError extends Error {
    code;
    operation;
    retryable;
    constructor(code, operation, retryable) {
        super(SAFE_MESSAGES[code]);
        this.code = code;
        this.operation = operation;
        this.retryable = retryable;
        this.name = "ProviderOperationError";
    }
}
function rawMessage(error) {
    if (error instanceof Error)
        return error.message.toLowerCase();
    return typeof error === "string" ? error.toLowerCase() : "";
}
function statusFrom(error) {
    if (!error || typeof error !== "object")
        return undefined;
    const candidate = error;
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
        if (typeof value === "number" && Number.isInteger(value))
            return value;
    }
    return undefined;
}
function classify(error) {
    if (error instanceof ProviderOperationError)
        return error.code;
    const message = rawMessage(error);
    const status = statusFrom(error);
    if (message.includes("oauth state") || message.includes("csrf"))
        return "OAUTH_STATE_INVALID";
    if ((message.includes("unsupported") || /not\s+(?:\w+\s+)?supported/.test(message))
        && message.includes("oauth"))
        return "OAUTH_UNSUPPORTED";
    if (message.includes("encryption") || message.includes("credential") || message.includes("no stored oauth")) {
        return "CREDENTIALS_UNAVAILABLE";
    }
    if (status === 401 || status === 403 || /\b401\b|\b403\b|unauthori[sz]ed|invalid[_ -]?(grant|token|credential)|authentication failed|xoauth2/.test(message)) {
        return "AUTH_FAILED";
    }
    if (status === 404 || /\b404\b|not found/.test(message))
        return "PROVIDER_NOT_FOUND";
    if (status === 408 || status === 504 || /timeout|timed out|aborterror/.test(message))
        return "PROVIDER_TIMEOUT";
    if (status === 429 || /\b429\b|rate limit|too many requests/.test(message))
        return "RATE_LIMITED";
    if (status === 400 || status === 409 || status === 422 || /bad request|invalid request|rejected/.test(message)) {
        return "PROVIDER_REJECTED";
    }
    if (status === 502 || status === 503 || /econnreset|econnrefused|enotfound|network|temporar(?:y|ily) unavailable|service unavailable/.test(message)) {
        return "PROVIDER_UNAVAILABLE";
    }
    if (/missing.*(password|token)|no .*password|no access token/.test(message))
        return "AUTH_REQUIRED";
    if (/configuration|client id|client secret/.test(message))
        return "CONFIGURATION_ERROR";
    return "PROVIDER_ERROR";
}
function isRetryable(code) {
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
export function sanitizeProviderError(error, operation) {
    if (error instanceof ProviderOperationError)
        return error;
    // Module reloads and bundled package boundaries can break `instanceof` even
    // for an error this module created. Accept only a known code, then rebuild a
    // fresh safe error instead of copying any untrusted message or stack.
    if (error && typeof error === "object" && "code" in error) {
        const candidate = error;
        if (typeof candidate.code === "string" && PROVIDER_ERROR_CODES.has(candidate.code)) {
            const source = typeof candidate.operation === "string"
                && ["oauth", "imap", "smtp", "sync", "api"].includes(candidate.operation)
                ? candidate.operation
                : operation;
            const code = candidate.code;
            return new ProviderOperationError(code, source, typeof candidate.retryable === "boolean"
                ? candidate.retryable
                : isRetryable(code));
        }
    }
    const code = classify(error);
    return new ProviderOperationError(code, operation, isRetryable(code));
}
/**
 * Strict redactor for callers that would otherwise be tempted to log raw text.
 * Returning a constant instead of a partially-redacted string avoids accidental
 * disclosure through an unrecognized provider header, URL query parameter, or
 * canary value.
 */
export function redactProviderDiagnostic(_value) {
    return "provider diagnostic redacted";
}
/** Return structured diagnostics that are explicitly safe for logs and telemetry. */
export function providerErrorDiagnostic(error, operation) {
    const safe = sanitizeProviderError(error, operation);
    return {
        operation,
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
    };
}
/** Safe public response fields. Never return a provider library message directly. */
export function providerErrorResponse(error, operation) {
    const safe = sanitizeProviderError(error, operation);
    return { code: safe.code, message: safe.message };
}
export function isAuthenticationProviderError(error, operation) {
    const code = sanitizeProviderError(error, operation).code;
    return code === "AUTH_REQUIRED" || code === "AUTH_FAILED" || code === "CREDENTIALS_UNAVAILABLE";
}
