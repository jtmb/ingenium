import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import AIActions from "../src/app/docs/components/AIActions";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

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
    installDashboardFetchMock(fetchMock);
    render(<AIActions fullContent="Docs content" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Summarize" }));

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
    installDashboardFetchMock(fetchMock);
    render(<AIActions selectedText="Selected words" fullContent="Full document" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Rewrite" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({ action: "rewrite", selectedText: "Selected words" });
    expect(await screen.findByText(/No documentation AI model is currently available/i)).toBeTruthy();
  });

  it("does not forward browser storage as a provider selection", async () => {
    localStorage.setItem("ingenium_chat_selection_v1", JSON.stringify({
      providerId: "provider with spaces",
      modelId: "model\u0000injection",
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { result: "AI output" } }), { status: 200 }));
    installDashboardFetchMock(fetchMock);
    render(<AIActions fullContent="Docs content" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Summarize" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("modelId");
  });

  it("sends a 70 KiB document unchanged and previews a successful summary", async () => {
    const content = "x".repeat(70 * 1024);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { result: "Large document summary" },
    }), { status: 200 }));
    installDashboardFetchMock(fetchMock);
    render(<AIActions fullContent={content} pageTitle="Architecture" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Summarize" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({ action: "summarize", content });
    expect(await screen.findByText("Large document summary")).toBeTruthy();
  });

  it("replaces unknown upstream errors with a safe Docs AI message", async () => {
    const privateUpstreamDetail = "provider endpoint=https://private.example api-key=must-not-leak";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "UPSTREAM_PROVIDER_FAILURE", message: privateUpstreamDetail },
    }), { status: 500, statusText: "Internal Server Error" }));
    installDashboardFetchMock(fetchMock);
    render(<AIActions fullContent="Docs content" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Summarize" }));

    expect(await screen.findByText(/Documentation AI is temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByText("Internal Server Error")).toBeNull();
    expect(screen.queryByText(privateUpstreamDetail)).toBeNull();
  });

  it("allows Outline for blank content when the page title is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { result: "## Release notes" } }), { status: 200 }));
    installDashboardFetchMock(fetchMock);
    render(<AIActions fullContent={" \n"} pageTitle="Release notes" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     const outline = screen.getByRole("menuitem", { name: "Outline" });
    expect((outline as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(outline);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toMatchObject({ action: "outline", content: " \n", title: "Release notes" });
  });

  it("disables content actions for whitespace-only content with useful explanations", () => {
    render(<AIActions fullContent={" \n\t"} pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));

    for (const label of ["Continue", "Summarize", "Fix grammar", "Professional", "Casual", "Technical"]) {
       const button = screen.getByRole("menuitem", { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute("title")).toMatch(/non-whitespace content/i);
    }
  });

  it("disables Rewrite for whitespace-only selection with a useful explanation", () => {
    render(<AIActions selectedText={" \n"} fullContent="Full document" pageTitle="Docs" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     const rewrite = screen.getByRole("menuitem", { name: "Rewrite" });

    expect((rewrite as HTMLButtonElement).disabled).toBe(true);
    expect(rewrite.getAttribute("title")).toMatch(/non-whitespace text/i);
  });

  it("keeps action and selection context with the preview result", async () => {
    const onApply = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { result: "Rewritten words" } }), { status: 200 }));
    installDashboardFetchMock(fetchMock);
    render(
      <AIActions
        selectedText="Selected words"
        selectionRange={{ start: 5, end: 19 }}
        fullContent="Full document"
        pageTitle="Docs"
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Rewrite" }));
    await screen.findByText("Rewritten words");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      action: "rewrite",
      result: "Rewritten words",
      sourceContent: "Full document",
      selectedText: "Selected words",
      selectionRange: { start: 5, end: 19 },
    });
  });

  it("keeps a stale page-wide preview actionable without applying over current edits", async () => {
    let resolveAI!: (response: Response) => void;
    const aiResponse = new Promise<Response>((resolve) => {
      resolveAI = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(aiResponse);
    installDashboardFetchMock(fetchMock);
    const onApply = vi.fn();
    const view = render(<AIActions fullContent="Original content" pageTitle="Docs" onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
     fireEvent.click(screen.getByRole("menuitem", { name: "Summarize" }));

    // The editor changes while the request is pending.
    view.rerender(<AIActions fullContent="Original content with user edits" pageTitle="Docs" onApply={onApply} />);
    resolveAI(new Response(JSON.stringify({ data: { result: "Stale summary" } }), { status: 200 }));

    await screen.findByText("Stale summary");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("Stale summary")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/page changed while AI was working/i);
  });
});
