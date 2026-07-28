import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import SettingsPage, { buildSettingsRedirectUrl } from "../src/app/settings/page";

describe("/settings compatibility redirect", () => {
  beforeEach(() => {
    routerMock.replace.mockReset();
    window.history.replaceState({}, "", "/settings");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("preserves project/query/hash context while supplying the default tab", () => {
    expect(buildSettingsRedirectUrl("?project=external-worktree&view=compact", "#retention"))
      .toBe("/?project=external-worktree&view=compact&settings=general#retention");
  });

  it("preserves an explicit settings tab instead of resetting it", () => {
    expect(buildSettingsRedirectUrl("?settings=mail&project=external-worktree", "#oauth"))
      .toBe("/?settings=mail&project=external-worktree#oauth");
  });

  it("redirects /settings using the browser's complete URL context", async () => {
    window.history.replaceState({}, "", "/settings?project=external-worktree&settings=providers#oauth");
    render(<SettingsPage />);

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith(
      "/?project=external-worktree&settings=providers#oauth",
      { scroll: false },
    ));
  });
});
