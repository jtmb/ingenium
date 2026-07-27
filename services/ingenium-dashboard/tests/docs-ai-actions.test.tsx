import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import AIActions from "../src/app/docs/components/AIActions";

describe("Docs AI actions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not send browser provider/model state or a project query parameter", async () => {
    localStorage.setItem("ingenium_chat_selection_v1", JSON.stringify({ providerId: "browser-provider", modelId: "browser-model" }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { result: "AI output" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AIActions fullContent="Docs content" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/docs/ai");
    expect(url).not.toContain("project=");
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ action: "summarize" });
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("modelId");
    expect(await screen.findByText("AI output")).toBeTruthy();
  });

  it("passes selected text to rewrite and surfaces an actionable unavailable-model error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "LLM_UNAVAILABLE", message: "No Chat provider or model is currently available. Open Chat or Settings → Providers, then try again." },
    }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AIActions selectedText="Selected words" fullContent="Full document" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Rewrite" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({ action: "rewrite", selectedText: "Selected words" });
    expect(await screen.findByText(/No Chat provider or model is currently available/i)).toBeTruthy();
  });

  it("does not forward browser storage as a provider selection", async () => {
    localStorage.setItem("ingenium_chat_selection_v1", JSON.stringify({
      providerId: "provider with spaces",
      modelId: "model\u0000injection",
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { result: "AI output" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AIActions fullContent="Docs content" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("modelId");
  });
});
