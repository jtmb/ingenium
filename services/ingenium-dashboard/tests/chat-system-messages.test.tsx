import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ChatMessages, { type ChatMessage } from "../src/app/chat/components/ChatMessages";
vi.mock("../src/app/chat/components/ChatMarkdown", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("../src/app/chat/components/ToolCallCard", () => ({ default: () => null }));
vi.mock("../src/app/chat/components/PermissionPrompt", () => ({ default: () => null }));
vi.mock("../src/app/chat/components/QuestionPrompt", () => ({ default: () => null }));
afterEach(cleanup);
const notice = "The Code Mode tool catalog has changed. No Code Mode tools are currently available.";
const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, timestamp: 1000 });

describe("native system messages in the chat transcript", () => {
  it("keeps system catalog instructions out of the user-facing conversation without changing its input", () => {
    const messages = [message("user", "user", "Hello"), message("system", "system", notice), message("answer", "assistant", "Ready")];
    render(<ChatMessages messages={messages} isLoading={false} />);
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(messages).toHaveLength(3);
    expect(messages[1]!.role).toBe("system");
  });
  it("preserves the same text when it is real user or assistant conversation content", () => {
    render(<ChatMessages messages={[message("user", "user", notice), message("answer", "assistant", notice)]} isLoading={false} />);
    expect(screen.getAllByText(notice)).toHaveLength(2);
  });
  it("shows the ordinary empty state and actual errors when only internal system messages exist", () => {
    const { rerender } = render(<ChatMessages messages={[message("system", "system", notice)]} isLoading={false} />);
    expect(screen.getByRole("heading", { name: "How can I help you today?" })).toBeInTheDocument();
    rerender(<ChatMessages messages={[message("system", "system", notice)]} isLoading={false} error="Unable to load conversation" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load conversation");
  });
});
