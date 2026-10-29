import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkArtifacts from "../src/app/components/veyra-work/WorkArtifacts";

vi.mock("next/image", () => ({ default: ({ alt, src, onError }: { alt: string; src: string; onError: () => void }) => <img alt={alt} src={src} onError={onError} /> }));
afterEach(cleanup);

describe("conversation artifact view", () => {
  it("retains exact source and strips automatic resource loads from explicit Markdown preview", () => {
    render(<WorkArtifacts artifacts={[{ id: "artifact-a", messageId: "message-a", name: "notes.md", mime: "text/markdown", content: '# Notes\n![tracking](https://example.test/image.png)\n<script>untrusted()</script>' }]} />);
    expect(screen.getByLabelText("Source: notes.md").textContent).toContain("<script>untrusted()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Markdown preview" }));
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(document.querySelector("img,script,iframe,object")).toBeNull();
  });

  it("resets selection when the prior file disappears, and never fetches unqualified references", () => {
    const view = render(<WorkArtifacts artifacts={[{ id: "first", messageId: "message-a", name: "first.txt", mime: "text/plain", content: "First exact source" }]} />);
    expect(screen.getByText("First exact source")).toBeTruthy();
    view.rerender(<WorkArtifacts artifacts={[{ id: "remote", messageId: "message-b", name: "remote.txt", mime: "text/plain", url: "https://example.test/private" }]} />);
    expect(screen.queryByText("First exact source")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("authorized file reader");
  });

  it("uses a sandboxed PDF viewer and distinguishes invalid JSON without changing its original", () => {
    const view = render(<WorkArtifacts artifacts={[{ id: "pdf", messageId: "message-a", name: "report.pdf", mime: "application/pdf", url: "data:application/pdf;base64,JVBERg==" }]} />);
    expect(screen.getByTitle("PDF preview: report.pdf").getAttribute("sandbox")).toBe("");
    expect(screen.getByRole("link", { name: "Download original PDF" }).getAttribute("download")).toBe("report.pdf");
    view.rerender(<WorkArtifacts artifacts={[{ id: "json", messageId: "message-a", name: "config.json", mime: "application/json", content: "{invalid}" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
    expect(screen.getByRole("status").textContent).toContain("not valid JSON");
    expect(screen.getByText("{invalid}")).toBeTruthy();
  });
});
