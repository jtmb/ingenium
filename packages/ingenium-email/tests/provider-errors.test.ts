import { describe, expect, it } from "vitest";
import {
  providerErrorDiagnostic,
  providerErrorResponse,
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

    expect(sanitized.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify({ sanitized, diagnostic, response })).not.toContain(PROVIDER_ERROR_CANARY);
  });
});
