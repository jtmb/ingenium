import { describe, expect, it } from "vitest";
import {
  providerErrorDiagnostic,
  providerErrorResponse,
  redactProviderDiagnostic,
  sanitizeProviderError,
} from "../lib/provider-errors.js";

const PROVIDER_ERROR_CANARY = "provider-error-canary-must-never-cross-the-boundary";

describe("provider error sanitization", () => {
  it("never returns a provider error canary through any safe diagnostic shape", () => {
    const upstreamError = new Error(
      `request failed at https://provider.invalid/oauth?token=${PROVIDER_ERROR_CANARY}`,
    );

    const sanitized = sanitizeProviderError(upstreamError, "oauth");
    const diagnostic = providerErrorDiagnostic(upstreamError, "oauth");
    const response = providerErrorResponse(upstreamError, "oauth");
    const redacted = redactProviderDiagnostic(upstreamError);

    expect(sanitized.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify({ sanitized, diagnostic, response, redacted })).not.toContain(PROVIDER_ERROR_CANARY);
    expect(redacted).toBe("provider diagnostic redacted");
  });
});
