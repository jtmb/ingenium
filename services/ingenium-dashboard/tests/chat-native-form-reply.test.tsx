import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("../src/app/chat/components/ChatMarkdown", () => ({ default: () => null }));
vi.mock("../src/app/chat/components/ToolCallCard", () => ({ default: () => null }));

import ChatMessages from "../src/app/chat/components/ChatMessages";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("replies once to the active native form request with typed answers, not a new prompt", () => {
  const replyQuestion = vi.fn(async () => undefined);
  const onRetry = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  render(React.createElement(ChatMessages, {
    messages: [{ id: "msg_user", role: "user", content: "Continue", timestamp: 1000 }],
    isLoading: false,
    isStreaming: false,
    onRetry,
    replyQuestion,
    questions: [
      { id: "field_count", requestId: "frm_native", question: "How many?", type: "integer", required: true },
      { id: "field_hidden", requestId: "frm_native", question: "Secret", hidden: true, default: "retained" },
      { id: "field_other", requestId: "frm_other", question: "Unrelated", type: "string" },
    ],
  }));

  expect(screen.getByTestId("chat-question-prompt")).toBeDefined();
  expect(screen.queryByText("Unrelated")).toBeNull();
  expect(screen.queryByText("Secret")).toBeNull();
  fireEvent.change(screen.getByRole("spinbutton", { name: "How many?" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));

  expect(replyQuestion).toHaveBeenCalledExactlyOnceWith("frm_native", { field_count: 2, field_hidden: "retained" });
  expect(onRetry).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
