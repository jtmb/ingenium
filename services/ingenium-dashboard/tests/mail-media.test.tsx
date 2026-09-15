import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("../src/app/mail/components/EmailComposer", () => ({ default: () => null }));

import EmailReader from "../src/app/mail/components/EmailReader";

const oversizedHtml = "x".repeat(2_000_001);
const sandbox = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function reader(body: { html?: string; text?: string }, uid = 42) {
  return (
    <EmailReader
      email={{ uid, folder: "INBOX", subject: "Synthetic media message", body }}
      loading={false}
      onForward={() => {}}
      onDelete={() => {}}
      onArchive={() => {}}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Mail-media tests must not use the network");
  }));
});

afterEach(() => {
  cleanup();
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("EmailReader mail media", () => {
  it.each([false, true])("shows oversized HTML as escaped, scrollable plain text (replying: %s)", (replying) => {
    const text = 'First line\n<script>alert("untrusted")</script>\n<img src="https://example.invalid/tracker">';
    render(reader({ html: oversizedHtml, text }));
    if (replying) fireEvent.click(screen.getByRole("button", { name: "Reply", exact: true }));

    const pane = screen.getByTestId("email-body-pane");
    expect(pane.querySelector("pre")?.textContent).toBe(text);
    expect(pane.querySelectorAll("script, img, iframe")).toHaveLength(0);
    expect(pane.classList.contains("overflow-y-auto")).toBe(true);
    expect(pane.classList.contains("overflow-hidden")).toBe(false);
    expect(screen.getByText(/This email is too large to preview/).textContent).toContain("Showing plain text.");
    expect(screen.queryByRole("button", { name: "View plain text" })).toBeNull();
  });

  it.each([undefined, ""])("shows an honest oversized notice when plain text is %s", (text) => {
    render(reader({ html: oversizedHtml, text }));

    expect(screen.getByText(/This email is too large to preview/).textContent).toContain("No plain text version is available.");
    expect(screen.getByTestId("email-body-pane").querySelectorAll("pre, iframe, button")).toHaveLength(0);
  });

  it("allows HTML at exactly 2,000,000 characters without relaxing the sandbox", () => {
    render(reader({ html: "x".repeat(2_000_000), text: "Unused fallback" }));

    const iframe = screen.getByTitle("Email content");
    expect(iframe.getAttribute("sandbox")).toBe(sandbox);
    expect(iframe.getAttribute("srcdoc")).toContain("x".repeat(2_000_000));
    expect(screen.getByTestId("email-body-pane").classList.contains("overflow-hidden")).toBe(true);
    expect(screen.queryByText("Unused fallback")).toBeNull();
    expect(screen.queryByText(/This email is too large to preview/)).toBeNull();
  });

  it("does not carry fallback content or presentation across messages", () => {
    const { rerender } = render(reader({ html: oversizedHtml, text: "First message fallback" }));
    expect(screen.getByText("First message fallback")).toBeTruthy();

    rerender(reader({ html: "<p>Second message</p>" }, 43));
    expect(screen.queryByText("First message fallback")).toBeNull();
    expect(screen.queryByText(/This email is too large to preview/)).toBeNull();
    expect(screen.getByTitle("Email content").getAttribute("srcdoc")).toContain("Second message");
    expect(screen.getByTitle("Email content").getAttribute("sandbox")).toBe(sandbox);

    rerender(reader({ html: oversizedHtml }, 44));
    expect(screen.queryByTitle("Email content")).toBeNull();
    expect(screen.queryByText("First message fallback")).toBeNull();
    expect(screen.getByText(/No plain text version is available/)).toBeTruthy();

    rerender(reader({ text: "Ordinary plain text" }, 45));
    expect(screen.getByText("Ordinary plain text").tagName).toBe("PRE");
    expect(screen.queryByText(/This email is too large to preview/)).toBeNull();
  });

  it.each([
    ["full document", `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><img alt="Synthetic image"></body></html>`, csp],
    ["body without head", '<body><img alt="Synthetic image"></body>', null],
    ["fragment", '<img alt="Synthetic image">', null],
  ])("keeps media defaults and iframe isolation for a %s", (_name, html, expectedCsp) => {
    render(reader({ html: html! }));

    const iframe = screen.getByTitle("Email content");
    expect(iframe.getAttribute("sandbox")).toBe(sandbox);
    const document = new DOMParser().parseFromString(iframe.getAttribute("srcdoc")!, "text/html");
    expect(document.head.textContent).toContain("color-scheme:light");
    expect(document.head.textContent).toContain("img{max-width:100%;height:auto}");
    expect(document.querySelector("base")?.getAttribute("target")).toBe("_blank");
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null).toBe(expectedCsp);
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("Synthetic image");
    expect(screen.queryByAltText("Synthetic image")).toBeNull();
  });
});
