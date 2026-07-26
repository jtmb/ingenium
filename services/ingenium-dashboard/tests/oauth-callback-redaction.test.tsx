import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => navigation.params,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import OAuthCallbackPage from "../src/app/mail/oauth/callback/page";
import {
  DEFAULT_OAUTH_CALLBACK_ERROR_MESSAGE,
  getOAuthCallbackErrorMessage,
} from "../src/app/mail/oauth/callback/messages";

const PROVIDER_ERROR_CANARY = "provider-error-description-canary";
const LEAKED_URL = "https://provider.example.test/internal?secret=should-not-render";

beforeEach(() => {
  navigation.params = new URLSearchParams();
  vi.stubGlobal("fetch", vi.fn());
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OAuth callback error redaction", () => {
  it("maps known provider codes to constant safe messages and ignores descriptions", async () => {
    navigation.params = new URLSearchParams([
      ["error", "access_denied"],
      ["error_description", `${PROVIDER_ERROR_CANARY} ${LEAKED_URL}`],
    ]);

    render(<OAuthCallbackPage />);

    expect(await screen.findByText("Authorization was declined. No email account was connected.")).toBeTruthy();
    expect(screen.queryByText(PROVIDER_ERROR_CANARY)).toBeNull();
    expect(screen.queryByText(LEAKED_URL)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redacts provider diagnostics returned inside an OAuth exchange error", async () => {
    navigation.params = new URLSearchParams("code=one-time-code&state=state");
    localStorage.setItem("oauth_provider", "gmail");
    localStorage.setItem("oauth_project", "global-default");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "OAUTH_STATE_INVALID",
        message: `${PROVIDER_ERROR_CANARY}: ${LEAKED_URL}`,
      },
    }), { status: 400 }));

    render(<OAuthCallbackPage />);

    expect(await screen.findByText("The authorization session expired or was invalid. Start the connection again.")).toBeTruthy();
    expect(screen.queryByText(PROVIDER_ERROR_CANARY)).toBeNull();
    expect(screen.queryByText(LEAKED_URL)).toBeNull();
  });

  it("uses a generic constant for unknown codes rather than echoing the code", () => {
    const result = getOAuthCallbackErrorMessage(`${PROVIDER_ERROR_CANARY} ${LEAKED_URL}`);
    expect(result).toBe(DEFAULT_OAUTH_CALLBACK_ERROR_MESSAGE);
    expect(result).not.toContain(PROVIDER_ERROR_CANARY);
    expect(result).not.toContain(LEAKED_URL);
  });
});
