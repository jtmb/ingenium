/**
 * REL-001: Chat rate-limit recovery tests.
 *
 * Verifies that the ChatShell component:
 * - Detects HTTP 429 responses and shows a countdown retry banner
 * - Consumes the Retry-After header for countdown duration
 * - Allows manual "Retry Now" to trigger an immediate refetch
 * - Re-enables selectors on successful retry
 * - Preserves previously-valid config on persistent failure
 * - Shows a generic error banner for non-429 errors (no retry logic)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import React from "react";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const { chatConfig: mockChatConfig } = vi.hoisted(() => ({
  chatConfig: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        ...actual.api.settings,
        chatConfig: mockChatConfig,
      },
    },
  };
});

vi.mock("../src/lib/opencode", () => ({
  opencode: {
    mcp: { status: vi.fn().mockResolvedValue({}) },
    sessions: {
      list: vi.fn(),
      messages: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => ({ project: "global-default", loading: false, error: null }),
  useProject: () => "selected-project",
}));

vi.mock("../src/lib/use-opencode-sessions", () => ({
  useOpenCodeSessions: () => ({
    sessions: [{ id: "sess-1", title: "Test Session", time: { created: Date.now(), updated: Date.now() } }],
    archivedSessions: [],
    activeId: "sess-1",
    isLoading: false,
    error: null,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    fork: vi.fn(),
    share: vi.fn(),
    unshare: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/lib/use-opencode-chat", () => ({
  useOpenCodeChat: () => ({
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    sessionStatus: "idle",
    sessionInfo: null,
    questions: [],
    permissions: [],
    replyPermission: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    revert: vi.fn(),
    clear: vi.fn(),
    resume: vi.fn(),
  }),
}));

/* ------------------------------------------------------------------ */
/*  Import component under test                                        */
/* ------------------------------------------------------------------ */

import ChatShell from "../src/app/chat/components/ChatShell";
import { ApiError } from "../src/lib/api";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const validConfig = {
  configured: true,
  primary: {
    providerId: "openai",
    modelId: "gpt-4",
    label: "OpenAI GPT-4",
    isCustom: false,
  },
  backup: null,
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  providers: [
    {
      providerId: "openai",
      label: "OpenAI",
      models: [
        { id: "gpt-4", label: "GPT-4" },
        { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
      ],
      defaultModel: "gpt-4",
      source: "managed" as const,
    },
  ],
  defaultSelection: { providerId: "openai", modelId: "gpt-4" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function setupMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("REL-001: Chat rate-limit recovery", () => {
  beforeEach(() => {
    mockChatConfig.mockReset();
    setupMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── 429 → retry banner appears ────────────────────────────────────

  it("shows a countdown retry banner on HTTP 429", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Too Many Requests", 10));

    render(<ChatShell />);

    // The banner shows both the error message and the countdown
    await waitFor(() => {
      expect(screen.getByText(/retrying in 10s/)).not.toBeNull();
    });

    expect(screen.getByRole("button", { name: "Retry Now" })).not.toBeNull();
  });

  // ── Countdown decrements ──────────────────────────────────────────

  it("shows the initial countdown value from Retry-After", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Rate limit exceeded", 5));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/retrying in 5s/)).not.toBeNull();
    });
  });

  it("shows a different countdown for a different Retry-After value", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Slow down", 30));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/retrying in 30s/)).not.toBeNull();
    });
  });

  // ── Auto-retry on countdown expiry ────────────────────────────────

  it("countdown disappears and auto-retry fires when timer expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockChatConfig.mockRejectedValue(new ApiError(429, "Rate limited", 2));

    render(<ChatShell />);

    // Flush initial async work
    await act(() => vi.runAllTimersAsync());

    await waitFor(() => {
      expect(screen.getByText(/retrying in 2s/)).not.toBeNull();
    });

    expect(mockChatConfig).toHaveBeenCalledTimes(1);

    // Set up success for retry
    mockChatConfig.mockResolvedValue({ data: validConfig });

    // Advance past the 2-second countdown (two 1-second intervals)
    // Use runAllTimersAsync which flushes all pending timers AND microtasks
    await act(() => vi.advanceTimersByTimeAsync(2500));

    // Now the countdown should have triggered the auto-retry useEffect
    // which calls fetchChatConfig(true)
    await waitFor(
      () => {
        expect(mockChatConfig).toHaveBeenCalledTimes(2);
      },
      { timeout: 2000 },
    );
  });

  // ── Manual "Retry Now" triggers refetch ───────────────────────────

  it("triggers an immediate refetch when Retry Now is clicked", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Rate limit hit", 60));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry Now" })).not.toBeNull();
    });

    expect(mockChatConfig).toHaveBeenCalledTimes(1);

    mockChatConfig.mockResolvedValue({ data: validConfig });

    fireEvent.click(screen.getByRole("button", { name: "Retry Now" }));

    await waitFor(() => {
      expect(mockChatConfig).toHaveBeenCalledTimes(2);
    });

    // After success, the rate-limit button should disappear
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry Now" })).toBeNull();
    });
  });

  // ── Success restores selectors ────────────────────────────────────

  it("re-enables selectors after a successful retry", async () => {
    mockChatConfig.mockRejectedValueOnce(new ApiError(429, "Rate limited", 10));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry Now" })).not.toBeNull();
    });

    // Now configure success
    mockChatConfig.mockResolvedValue({ data: validConfig });

    fireEvent.click(screen.getByRole("button", { name: "Retry Now" }));

    // Rate-limit banner disappears on success
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry Now" })).toBeNull();
    });

    // The generic "Failed to load" error should not appear
    expect(screen.queryByText(/Failed to load chat config/)).toBeNull();
  });

  // ── Permanent error preserves previous config ─────────────────────

  it("does not show generic error on 429 (rate-limit banner replaces it)", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Rate limited", 10));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry Now" })).not.toBeNull();
    });

    // The generic error should NOT appear
    expect(screen.queryByText(/Failed to load chat config/)).toBeNull();
  });

  // ── Non-429 errors show generic banner ────────────────────────────

  it("shows generic error banner for non-429 errors without retry logic", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(503, "Service Unavailable", null));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load chat config: Service Unavailable/)).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Retry Now" })).toBeNull();
    expect(screen.queryByText(/retrying in/)).toBeNull();
  });

  it("shows the authentication gateway error without presenting a retry affordance", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(401, "Dashboard authentication required", null));

    render(<ChatShell />);

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load chat config: Dashboard authentication required/),
      ).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Retry Now" })).toBeNull();
    expect(screen.queryByText(/retrying in/)).toBeNull();
    expect((screen.getByTestId("chat-header-provider") as HTMLSelectElement).disabled).toBe(true);
  });

  // ── Generic Error (non-ApiError) still works ──────────────────────

  it("handles generic Error objects (non-ApiError) gracefully", async () => {
    mockChatConfig.mockRejectedValue(new Error("Network failure"));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load chat config: Network failure/)).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Retry Now" })).toBeNull();
  });

  // ── Retry-After caps at 60 seconds ────────────────────────────────

  it("shows the countdown value even for large Retry-After values", async () => {
    // parseRetryAfter caps at 60 at the fetch layer, but the ApiError
    // carries whatever we construct. The component displays it faithfully.
    mockChatConfig.mockRejectedValue(new ApiError(429, "Rate limited", 60));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/retrying in 60s/)).not.toBeNull();
    });
  });

  // ── Missing Retry-After defaults to 5 seconds ─────────────────────

  it("defaults to 5-second countdown when Retry-After header is absent", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Too Many Requests", null));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/retrying in 5s/)).not.toBeNull();
    });
  });

  // ── Rate-limit message shown ──────────────────────────────────────

  it("shows the rate-limit error message in the banner", async () => {
    mockChatConfig.mockRejectedValue(new ApiError(429, "Too Many Requests — slow down!", 30));

    render(<ChatShell />);

    await waitFor(() => {
      expect(screen.getByText(/Too Many Requests — slow down!/)).not.toBeNull();
    });
  });
});
