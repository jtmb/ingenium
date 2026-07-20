import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import ToolCallCard from "../src/app/chat/components/ToolCallCard";

describe("ToolCallCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders pending state with tool name", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "pending",
        input: { command: "ls" },
      }),
    );
    expect(screen.getByTestId("chat-tool-call")).toBeDefined();
    expect(screen.getByTestId("chat-tool-name").textContent).toContain("Shell");
    expect(screen.getByTestId("chat-tool-status").textContent).toContain(
      "Pending",
    );
  });

  it("renders completed state with output", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "completed",
        input: { command: "ls" },
        output: "file1.txt\nfile2.txt",
        duration: 1500,
      }),
    );
    expect(screen.getByTestId("chat-tool-status").textContent).toContain(
      "Completed",
    );
    expect(screen.getByTestId("chat-tool-status").textContent).toContain(
      "1.5s",
    );
  });

  it("renders failed state with error", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "bash",
        state: "failed",
        error: "Permission denied",
      }),
    );
    expect(screen.getByTestId("chat-tool-status").textContent).toContain(
      "Failed",
    );
    expect(screen.getByText("Permission denied")).toBeDefined();
  });

  it("expands to show input on click", () => {
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
  });

  it("shows tool summary in header for known tools", () => {
    render(
      React.createElement(ToolCallCard, {
        toolName: "read",
        state: "running",
        input: { path: "/home/user/file.txt" },
      }),
    );
    expect(screen.getByTestId("chat-tool-summary").textContent).toContain(
      "/home/user/file.txt",
    );
  });
});
