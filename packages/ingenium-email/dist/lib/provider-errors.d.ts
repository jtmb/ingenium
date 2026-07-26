/**
 * Safe boundary for errors originating with OAuth, IMAP, SMTP, and provider APIs.
 *
 * Provider libraries commonly include request URLs, response bodies, headers, and
 * occasionally credentials in their errors. Those values must never cross into a
 * response, durable diagnostic, or log entry. Keep only a stable error code and a
 * user-actionable, provider-agnostic message.
 */
export type ProviderOperation = "oauth" | "imap" | "smtp" | "sync" | "api";
export type ProviderErrorCode = "AUTH_REQUIRED" | "AUTH_FAILED" | "OAUTH_STATE_INVALID" | "OAUTH_UNSUPPORTED" | "RATE_LIMITED" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_NOT_FOUND" | "PROVIDER_REJECTED" | "CREDENTIALS_UNAVAILABLE" | "CONFIGURATION_ERROR" | "PROVIDER_ERROR";
export interface ProviderErrorDiagnostic {
    operation: ProviderOperation;
    code: ProviderErrorCode;
    message: string;
    retryable: boolean;
}
export declare class ProviderOperationError extends Error {
    readonly code: ProviderErrorCode;
    readonly operation: ProviderOperation;
    readonly retryable: boolean;
    constructor(code: ProviderErrorCode, operation: ProviderOperation, retryable: boolean);
}
/**
 * Convert an untrusted provider error to the only error representation that may
 * be logged or returned. Raw error text is inspected only for classification and
 * is deliberately not retained as a cause or diagnostic field.
 */
export declare function sanitizeProviderError(error: unknown, operation: ProviderOperation): ProviderOperationError;
/**
 * Strict redactor for callers that would otherwise be tempted to log raw text.
 * Returning a constant instead of a partially-redacted string avoids accidental
 * disclosure through an unrecognized provider header, URL query parameter, or
 * canary value.
 */
export declare function redactProviderDiagnostic(_value: unknown): string;
/** Return structured diagnostics that are explicitly safe for logs and telemetry. */
export declare function providerErrorDiagnostic(error: unknown, operation: ProviderOperation): ProviderErrorDiagnostic;
/** Safe public response fields. Never return a provider library message directly. */
export declare function providerErrorResponse(error: unknown, operation: ProviderOperation): {
    code: ProviderErrorCode;
    message: string;
};
export declare function isAuthenticationProviderError(error: unknown, operation: ProviderOperation): boolean;
//# sourceMappingURL=provider-errors.d.ts.map