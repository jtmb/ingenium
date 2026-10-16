import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import PermissionPrompt from "../src/app/chat/components/PermissionPrompt";
import QuestionPrompt from "../src/app/chat/components/QuestionPrompt";

const outputChrome = /\b(?:border|rounded|bg-)/;

function expectPlainFlow(container: HTMLElement): void {
  for (const element of container.querySelectorAll("[class]")) {
    if (element instanceof HTMLElement) {
      expect(element.className).not.toMatch(outputChrome);
    }
  }
}

describe("agent output prompts", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders a permission request as borderless inline flow", () => {
    const { container } = render(
      React.createElement(PermissionPrompt, {
        requestId: "permission-1",
        action: "bash",
        pattern: "npm test",
        onReply: () => undefined,
        isActive: true,
      }),
    );

    expect(screen.getByTestId("chat-permission-prompt")).toBeDefined();
    expectPlainFlow(container);
  });

  it("renders an agent question and selectable answers without card chrome", () => {
    const { container } = render(
      React.createElement(QuestionPrompt, {
        requestId: "question-1",
        questions: [
          {
            id: "question-1",
            question: "Continue?",
            options: [
              { label: "Yes", description: "Proceed with the change" },
              { label: "No", description: "Stop here" },
            ],
          },
        ],
        onReply: () => undefined,
        isActive: true,
      }),
    );

    expect(screen.getByTestId("chat-question-prompt")).toBeDefined();
    expectPlainFlow(container);
  });

  it("submits typed native answers and excludes hidden or unmet conditional fields", () => {
    const replies: unknown[] = [];
    render(React.createElement(QuestionPrompt, {
      requestId: "frm_1",
      questions: [
        { id: "confirmed", question: "Proceed?", type: "boolean", required: true },
        { id: "count", question: "How many?", type: "integer", minimum: 1, required: true, when: [{ key: "confirmed", op: "eq", value: true }] },
        { id: "private", question: "Hidden", type: "string", hidden: true, default: "stored" },
      ],
      onReply: (_requestId, answers) => replies.push(answers),
      isActive: true,
    }));

    expect(screen.queryByLabelText("How many?")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("How many?"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    expect(replies).toEqual([{ confirmed: true, count: 2, private: "stored" }]);
  });

  it.each(["number", "integer"] as const)("matches %s conditions without treating an empty input as zero", (type) => {
    const replies: unknown[] = [];
    render(React.createElement(QuestionPrompt, {
      requestId: "frm_numeric",
      questions: [
        { id: "quantity", question: "Quantity?", type, required: true },
        { id: "equal", question: "Exactly two?", when: [{ key: "quantity", op: "eq", value: 2 }] },
        { id: "unequal", question: "Not two?", when: [{ key: "quantity", op: "neq", value: 2 }] },
        { id: "zero", question: "Zero?", when: [{ key: "quantity", op: "eq", value: 0 }] },
      ],
      onReply: (_requestId, answers) => replies.push(answers),
      isActive: true,
    }));

    expect(screen.queryByLabelText("Exactly two?")).toBeNull();
    expect(screen.queryByLabelText("Not two?")).toBeNull();
    fireEvent.change(screen.getByLabelText("Quantity?"), { target: { value: "2" } });
    expect(screen.getByLabelText("Exactly two?")).toBeDefined();
    expect(screen.queryByLabelText("Not two?")).toBeNull();
    expect(screen.queryByLabelText("Zero?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    expect(replies).toEqual([{ quantity: 2 }]);
    fireEvent.change(screen.getByLabelText("Quantity?"), { target: { value: "" } });
    expect(screen.queryByLabelText("Exactly two?")).toBeNull();
    expect(screen.queryByLabelText("Zero?")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
  });

  it("submits an applicable hidden default without replying to an external question", () => {
    const replies: unknown[] = [];
    const { rerender } = render(React.createElement(QuestionPrompt, {
      requestId: "frm_default",
      questions: [
        { id: "internal", question: "Internal", hidden: true, default: "saved" },
        { id: "external", question: "Authenticate", type: "external", url: "https://example.com" },
      ],
      onReply: (_requestId, answers) => replies.push(answers),
      isActive: true,
    }));

    expect(screen.queryByText("Internal")).toBeNull();
    expect(screen.getByRole("link", { name: "Continue in a new tab" })).toBeDefined();
    const submit = screen.getByRole("button", { name: "Submit Answer" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(replies).toEqual([{ internal: "saved" }]);

    rerender(React.createElement(QuestionPrompt, {
      requestId: "frm_external",
      questions: [{ id: "external", question: "Authenticate", type: "external", url: "https://example.com" }],
      onReply: (_requestId, answers) => replies.push(answers),
      isActive: true,
    }));
    expect(screen.queryByRole("button", { name: "Submit Answer" })).toBeNull();
  });

  it.each(["https://auth.example.test/continue?state=a%2Fb", "http://127.0.0.1:1455/auth/callback?code=one"])(
    "renders an absolute HTTP(S) external URL without making it an answer: %s",
    (url) => {
      render(React.createElement(QuestionPrompt, {
        requestId: "frm_external",
        questions: [{ id: "external", question: "Authenticate", type: "external", url }],
        onReply: () => { throw new Error("external URL is not an answer"); },
        isActive: true,
      }));
      const link = screen.getByRole("link", { name: "Continue in a new tab" });
      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.queryByRole("button", { name: "Submit Answer" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Authenticate" })).toBeNull();
    },
  );

  it.each([
    "javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "//auth.example.test/continue",
    "/auth/callback", "not a URL", "https://", " https://auth.example.test/continue",
    "https://auth.example.test/\ncontinue", "java\tscript:alert(1)", "",
  ])("renders an inert external field for an unsafe URL: %s", (url) => {
    const replies: unknown[] = [];
    const { container } = render(React.createElement(QuestionPrompt, {
      requestId: "frm_external",
      questions: [{ id: "external", question: "Authenticate", type: "external", url }],
      onReply: (...args) => replies.push(args),
      isActive: true,
    }));
    expect(screen.getByRole("status")).toHaveTextContent("External link unavailable");
    expect(container.querySelector("a[href]")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Authenticate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit Answer" })).toBeNull();
    expect(replies).toEqual([]);
  });

  it("renders inert fallback for a malformed native URL value", () => {
    const { container } = render(React.createElement(QuestionPrompt, {
      requestId: "frm_external",
      questions: [{ id: "external", question: "Authenticate", type: "external", url: 42 as unknown as string }],
      onReply: () => { throw new Error("malformed external URL is not an answer"); },
      isActive: true,
    }));
    expect(screen.getByRole("status")).toHaveTextContent("External link unavailable");
    expect(container.querySelector("a[href], input")).toBeNull();
  });
});
