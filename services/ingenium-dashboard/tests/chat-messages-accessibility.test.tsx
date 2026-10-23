// @vitest-environment node

import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { it } from "vitest";
import type { ComponentProps } from "react";
import type ChatMessages from "../src/app/chat/components/ChatMessages";

type ChatProps = ComponentProps<typeof ChatMessages>;

it("supports keyboard image disclosure and announces only initial loading/error text", async () => {
  // jsdom does not perform native button activation from keyboard events.
  const bundle = await build({
    stdin: {
      contents: `
        import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import ChatMessages from "./src/app/chat/components/ChatMessages";
        const root = createRoot(document.getElementById("root"));
        window.renderChat = (props) => flushSync(() => root.render(createElement(ChatMessages, props)));
      `,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const render = (props: ChatProps) => page.evaluate((nextProps) => {
      (window as unknown as { renderChat: (props: ChatProps) => void }).renderChat(nextProps);
    }, props);
    const messages: ChatProps["messages"] = [{
      id: "assistant-image",
      role: "assistant",
      content: "Conversation content must not be a live announcement.",
      timestamp: 1_000,
      parts: [{
        id: "image-file",
        sessionID: "conversation",
        messageID: "assistant-image",
        type: "file",
        mime: "image/svg+xml",
        filename: "diagram.svg",
        dataUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"/>',
      }],
    }];

    await render({ messages, isLoading: false });
    const image = page.getByRole("img", { name: "diagram.svg", exact: true });
    const expand = page.getByRole("button", { name: "Expand diagram.svg", exact: true });
    const collapse = page.getByRole("button", { name: "Collapse diagram.svg", exact: true });
    await expect(expand).toHaveJSProperty("tagName", "BUTTON");
    await expect(expand).toHaveAttribute("type", "button");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Tab");
    await expect(expand).toBeFocused();

    for (const key of ["Enter", "Space"]) {
      await page.keyboard.press(key);
      await expect(collapse).toHaveAttribute("aria-expanded", "true");
      await expect(collapse).toBeFocused();
      await expect(image).toHaveAttribute("alt", "diagram.svg");
      await expect(image).toHaveClass("max-w-full");
      await page.keyboard.press(key);
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expect(expand).toBeFocused();
      await expect(image).toHaveClass(/max-h-48/);
    }
    await expect(expand).toHaveClass(/border-0 bg-transparent p-0/);
    await expect(page.getByTestId("chat-file-image")).not.toHaveClass(/\b(?:border|rounded|bg-)/);
    await expect(page.getByTestId("chat-assistant-message")).not.toHaveClass(/\b(?:border|rounded|bg-)/);

    await render({
      messages: [{ ...messages[0]!, parts: [{ ...messages[0]!.parts![0]!, filename: undefined }] }],
      isLoading: false,
    });
    await expect(page.getByRole("button", { name: "Expand attached image", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "attached image", exact: true })).toHaveAttribute("alt", "attached image");

    await render({ messages: [], isLoading: true, error: "Earlier load failed" });
    await expect(page.getByRole("status")).toHaveText("Loading conversation...");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await render({ messages: [], isLoading: false, error: "Unable to load conversation" });
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveText("Unable to load conversation");

    await render({ messages: [], isLoading: false });
    await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
    await expect(page.locator('[role="status"], [role="alert"], [aria-live]')).toHaveCount(0);

    await render({ messages, isLoading: true, error: "The stream disconnected" });
    await expect(page.getByRole("alert")).toHaveText("The stream disconnected");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByTestId("chat-assistant-message")).toContainText(messages[0]!.content);
    expect(await page.getByTestId("chat-assistant-message").evaluate((element) =>
      element.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') === null,
    )).toBe(true);
  } finally {
    await browser.close();
  }
}, 30_000);
