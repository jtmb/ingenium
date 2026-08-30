import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import ToolCallCard, {
  extractWebSearchSites,
  getSafeToolErrorMessage,
} from "../src/app/chat/components/ToolCallCard";

describe("ToolCallCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders a pending tool as a muted inline trace", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "pending",
        input: { command: "ls" },
      }),
    );
    const trace = screen.getByTestId("chat-tool-call");
    expect(trace).toBeDefined();
    expect(screen.getByTestId("chat-tool-name").textContent).toContain("Shell");
    expect(screen.getByTestId("chat-tool-summary").textContent).toContain("ls");
    expect(trace.textContent).toContain("·");
    expect(screen.getByTestId("chat-tool-icon")).toBeDefined();
    expect(trace.querySelector("button")).toBeNull();
    expect(trace.getAttribute("aria-expanded")).toBeNull();
    expect(screen.queryByTestId("chat-tool-status")).toBeNull();
    expect(trace.className).not.toMatch(/\b(?:border|rounded|bg-)/);
  });

  it("keeps completed execution details out of the trace", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "completed",
        input: { command: "ls" },
        output: "file1.txt\nfile2.txt",
        duration: 1500,
      }),
    );
    expect(screen.getByTestId("chat-tool-name").textContent).toContain("Shell");
    expect(screen.getByTestId("chat-tool-summary").textContent).toContain(
      "ls",
    );
    expect(screen.queryByTestId("chat-tool-status")).toBeNull();
    expect(screen.queryByTestId("chat-tool-input")).toBeNull();
    expect(screen.queryByTestId("chat-tool-output")).toBeNull();
    expect(screen.queryByText("Completed", { exact: true })).toBeNull();
    expect(screen.queryByText("1.5s", { exact: true })).toBeNull();
    expect(screen.queryByText("file1.txt", { exact: true })).toBeNull();
  });

  it("does not expose failed-state metadata in the trace", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "failed",
        error: "Permission denied",
      }),
    );
    expect(screen.getByTestId("chat-tool-name").textContent).toContain("Shell");
    expect(screen.queryByTestId("chat-tool-status")).toBeNull();
    expect(screen.queryByText("Failed", { exact: true })).toBeNull();
    expect(screen.queryByText("Permission denied", { exact: true })).toBeNull();
    expect(screen.getByTestId("chat-tool-call").querySelector("button")).toBeNull();
  });

  it.each([
    ["TOOL_DISABLED", "This tool is disabled for the project."],
    ["TOOL_STATE_UNAVAILABLE", "The tool state could not be verified."],
    ["PROJECT_IDENTITY_REQUIRED", "This tool requires a valid project identity."],
    ["private provider diagnostic", "Tool execution failed."],
  ])("renders a fixed safe message for %s", (error, message) => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "mcp_custom_tool",
        state: "failed",
        error,
      }),
    );

    expect(screen.getByTestId("chat-tool-error").textContent).toBe(message);
    expect(screen.queryByText(error, { exact: true })).toBeNull();
  });

  it("normalizes unknown tool errors without exposing their contents", () => {
    expect(getSafeToolErrorMessage("Bearer secret-token upstream failure")).toBe("Tool execution failed.");
    expect(getSafeToolErrorMessage()).toBe("Tool execution failed.");
  });

  it("reads only an exact MCP JSON error envelope from output", () => {
    expect(getSafeToolErrorMessage(undefined, JSON.stringify({
      error: { code: "TOOL_DISABLED", message: "private detail" },
    }))).toBe("This tool is disabled for the project.");
    expect(getSafeToolErrorMessage(undefined, JSON.stringify({
      error: { code: "TOOL_DISABLED_EXTRA", message: "private detail" },
    }))).toBe("Tool execution failed.");
    expect(getSafeToolErrorMessage(undefined, {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({ error: { code: "PROJECT_IDENTITY_REQUIRED" } }),
      }],
    })).toBe("This tool requires a valid project identity.");
  });

  it("never creates an MCP link from an unsafe project name", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "mcp_custom_tool",
        state: "failed",
        error: "TOOL_DISABLED",
        mcpProject: "global/default",
      }),
    );

    expect(screen.queryByRole("link", { name: /MCP Servers/ })).toBeNull();
  });

  it("preserves the argument summary without an expandable body", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "read",
        state: "pending",
        input: { path: "/etc/hosts" },
      }),
    );
    // Initially shows summary
    expect(screen.getByTestId("chat-tool-summary").textContent).toContain(
      "/etc/hosts",
    );
    expect(screen.queryByTestId("chat-tool-input")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the recognizable globe icon for Web Search", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "web_search",
        state: "completed",
        input: { query: "latest TypeScript release" },
      }),
    );

    const icon = screen.getByTestId("chat-tool-globe-icon");
    expect(icon.querySelector("circle")).not.toBeNull();
    expect(icon.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(screen.getByTestId("chat-tool-name").textContent).toContain(
      "Web Search",
    );
  });

  it("opens the shared activity flow instead of rendering inline details", () => {
    const onWebSearchOpen = vi.fn();
    render(
      React.createElement(ToolCallCard, {
        toolName: "web_search",
        state: "running",
        input: { query: "latest TypeScript release" },
        onWebSearchOpen,
      }),
    );

    const trigger = screen.getByRole("button", { name: /Web Search/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("chat-tool-details")).toBeNull();

    fireEvent.click(trigger);

    expect(onWebSearchOpen).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("chat-tool-details")).toBeNull();
    expect(screen.queryByTestId("chat-tool-status")).toBeNull();
    expect(screen.queryByText("Completed", { exact: true })).toBeNull();
  });

  it("keeps query-only Web Search output free of a fabricated site list", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "web_search",
        state: "completed",
        input: { query: "https://query-only.example.test/not-a-result" },
        output: { query: "https://query-only.example.test/not-a-result" },
      }),
    );

    fireEvent.click(screen.getByTestId("chat-tool-trigger"));
    expect(screen.queryByTestId("chat-web-search-sites")).toBeNull();
    expect(screen.queryByTestId("chat-web-search-link")).toBeNull();
  });

  it("exposes Web Search as a native keyboard-accessible disclosure control", () => {
    const onWebSearchOpen = vi.fn();
    render(
      React.createElement(ToolCallCard, {
        toolName: "websearch",
        state: "pending",
        input: { query: "keyboard accessible search" },
        onWebSearchOpen,
      }),
    );

    const trigger = screen.getByTestId("chat-tool-trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(onWebSearchOpen).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the raw tool name for unknown tools", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "mcp_custom_tool",
        state: "running",
        callID: "call-123",
      }),
    );
    expect(screen.getByTestId("chat-tool-name").textContent).toContain(
      "mcp_custom_tool",
    );
    expect(screen.getByTestId("chat-tool-name").textContent).not.toContain(
      "call-123",
    );
  });
});

describe("extractWebSearchSites", () => {
  it("recursively collects result and explicitly visited/crawled URLs", () => {
    expect(
      extractWebSearchSites({
        results: [
          { url: "https://results.example.test/first" },
          { nested: { href: "https://results.example.test/second" } },
        ],
        metadata: {
          crawled: [
            { sourceUrl: "https://visited.example.test/crawled" },
          ],
        },
      }),
    ).toEqual([
      { url: "https://results.example.test/first", label: "Results" },
      { url: "https://results.example.test/second", label: "Results" },
      { url: "https://visited.example.test/crawled", label: "Visited" },
    ]);
  });

  it("labels URLs as Visited only for explicit collections or local positive flags", () => {
    expect(
      extractWebSearchSites({
        results: [
          {
            url: "https://results.example.test/ordinary",
            visited: ["https://visited.example.test/nested-collection"],
            crawled: { href: "https://visited.example.test/nested-object" },
            status: "visited",
            unvisited: ["https://sites.example.test/unvisited"],
          },
          {
            url: "https://visited.example.test/positive-flag",
            isVisited: true,
            status: "unvisited",
          },
          {
            url: "https://visited.example.test/direct-visited-flag",
            visited: true,
          },
          {
            url: "https://visited.example.test/direct-crawled-flag",
            crawled: true,
          },
          {
            url: "https://results.example.test/negative-flag",
            visited: false,
            crawled: "false",
          },
          {
            url: "https://results.example.test/nested-flag-sibling",
            metadata: { visited: true },
          },
        ],
        visited_urls: ["https://visited.example.test/explicit-collection"],
        metadata: {
          status: "crawled",
          url: "https://sites.example.test/status-only",
        },
      }),
    ).toEqual([
      { url: "https://results.example.test/ordinary", label: "Results" },
      { url: "https://visited.example.test/nested-collection", label: "Visited" },
      { url: "https://visited.example.test/nested-object", label: "Visited" },
      { url: "https://sites.example.test/unvisited", label: "Results" },
      { url: "https://visited.example.test/positive-flag", label: "Visited" },
      { url: "https://visited.example.test/direct-visited-flag", label: "Visited" },
      { url: "https://visited.example.test/direct-crawled-flag", label: "Visited" },
      { url: "https://results.example.test/negative-flag", label: "Results" },
      { url: "https://results.example.test/nested-flag-sibling", label: "Results" },
      { url: "https://visited.example.test/explicit-collection", label: "Visited" },
      { url: "https://sites.example.test/status-only", label: "Sites" },
    ]);
  });

  it("rejects unsafe, malformed, credentialed, and duplicate URL values", () => {
    expect(
      extractWebSearchSites({
        results: [
          { url: "https://safe.example.test/result" },
          { url: "https://safe.example.test/result" },
          { url: "javascript:alert(1)" },
          { url: "data:text/html,unsafe" },
          { url: "ftp://unsafe.example.test/file" },
          { url: "https://user:secret@unsafe.example.test/credentialed" },
          { url: "https://unsafe.example.test/control\ncharacter" },
          { url: "https://" },
        ],
        visited: [
          // A concrete visited field upgrades an earlier duplicate result.
          { url: "https://safe.example.test/result" },
        ],
      }),
    ).toEqual([
      { url: "https://safe.example.test/result", label: "Visited" },
    ]);
  });

  it("does not treat query echoes or unknown text as search sites", () => {
    expect(
      extractWebSearchSites({
        query: "https://query.example.test/not-a-result",
        description: "https://unknown.example.test/not-an-explicit-url-field",
      }),
    ).toEqual([]);
  });

  it("extracts ordered markdown, autolink, and bare URLs from provider text", () => {
    expect(
      extractWebSearchSites(
        "[First result](https://first.example.test/page)\n"
        + "<https://second.example.test/page>\n"
        + "Bare result: https://third.example.test/page.\n"
        + "Duplicate: https://first.example.test/page",
      ),
    ).toEqual([
      { url: "https://first.example.test/page", label: "Sites" },
      { url: "https://second.example.test/page", label: "Sites" },
      { url: "https://third.example.test/page", label: "Sites" },
    ]);
  });

  it("rejects unsafe text URLs and an echoed URL query", () => {
    expect(
      extractWebSearchSites(
        "[unsafe](javascript:alert(1)) ftp://unsafe.example.test/file\n"
        + "https://user:secret@unsafe.example.test/private\n"
        + "https://unsafe.example.test/control\u0000character\n"
        + "https://query.example.test/not-a-result",
        "https://query.example.test/not-a-result",
      ),
    ).toEqual([]);
  });

  it("reads text-bearing provider fields but not arbitrary metadata", () => {
    expect(
      extractWebSearchSites({
        text: "Markdown [result](https://text.example.test/result)",
        description: "https://metadata.example.test/not-a-result",
      }),
    ).toEqual([
      { url: "https://text.example.test/result", label: "Sites" },
    ]);
  });
});
