import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import ToolCallCard from "../src/app/chat/components/ToolCallCard";

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

  it("discloses the actual search query inline when opened", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "web_search",
        state: "running",
        input: { query: "latest TypeScript release" },
      }),
    );

    const trigger = screen.getByRole("button", { name: /Web Search/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("chat-tool-details")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("chat-tool-details").textContent).toContain(
      "latest TypeScript release",
    );
    expect(screen.getByTestId("chat-tool-details").textContent).toContain(
      "Search query:",
    );
    expect(screen.queryByTestId("chat-tool-status")).toBeNull();
    expect(screen.queryByText("Completed", { exact: true })).toBeNull();
    expect(screen.queryByText("Duration", { exact: true })).toBeNull();
    expect(screen.getByTestId("chat-tool-details").className).not.toMatch(
      /\b(?:border|rounded|bg-)/,
    );

    fireEvent.click(trigger);
    expect(screen.queryByTestId("chat-tool-details")).toBeNull();
  });

  it("exposes Web Search as a native keyboard-accessible disclosure control", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "websearch",
        state: "pending",
        input: { query: "keyboard accessible search" },
      }),
    );

    const trigger = screen.getByTestId("chat-tool-trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(trigger, { key: " " });
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
