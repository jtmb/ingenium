import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
