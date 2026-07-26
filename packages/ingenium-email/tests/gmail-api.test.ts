import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ProviderOperationError } from "../lib/provider-errors.js";

const RESPONSE_CANARY = "gmail-success-body-canary-must-not-leak";

function malformedSuccessResponse(): Response {
  return new Response(`{"error":"${RESPONSE_CANARY}"`, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function captureFailure(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
    throw new Error("Expected Gmail API operation to fail");
  } catch (error: unknown) {
    return error;
  }
}

function expectSanitizedGmailFailure(error: unknown, requireSourceInstance: boolean): void {
  // The built release has its own module copy of provider-errors, so an
  // instanceof check would reject an otherwise valid cross-bundle contract.
  if (requireSourceInstance) expect(error).toBeInstanceOf(ProviderOperationError);
  expect(error).toMatchObject({
    code: "PROVIDER_ERROR",
    operation: "api",
    retryable: true,
    message: "The email operation could not be completed. Try again later.",
  });
  expect(error).not.toHaveProperty("response");

  const serialized = [
    String(error),
    JSON.stringify(error),
    error instanceof Error ? error.stack ?? "" : "",
  ].join("\n");
  expect(serialized).not.toContain(RESPONSE_CANARY);
}

describe("Gmail API response sanitization", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedSuccessResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sanitizes malformed JSON in a successful response without leaking its body", async () => {
    const { getProfile } = await import("../lib/providers/gmail-api.js");
    const error = await captureFailure(() => getProfile("access-token"));

    expectSanitizedGmailFailure(error, true);
  });

  it("keeps malformed-success sanitization in the published entrypoint", async () => {
    const built = await import("../dist/index.js");
    expect(built.getProfile).toBeTypeOf("function");
    const error = await captureFailure(() => built.getProfile("access-token"));

    expectSanitizedGmailFailure(error, false);
  });
});
