import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WorkChanges from "../src/app/components/veyra-work/WorkChanges";

afterEach(cleanup);
describe("session file changes", () => {
  it("renders real text patches in unified and split modes without executing source", () => {
    render(<WorkChanges value={[{ path: "src/view.ts", patch: "@@ -1 +1 @@\n-old\n+<script>untrusted()</script>\n", additions: 1, deletions: 1 }]} />);
    expect(screen.getByRole("region", { name: "Unified changes for src/view.ts" })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "split" }));
    expect(screen.getByRole("region", { name: "Split changes for src/view.ts" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Before" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "After" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "source" }));
    expect(screen.getByText(/@@ -1 \+1 @@/)).toBeTruthy();
  });

  it("keeps binary/invalid original responses visible and distinguishes empty changes", () => {
    const view = render(<WorkChanges value={[{ path: "image.png", patch: "Binary files differ", additions: 0, deletions: 0 }]} />);
    expect(screen.getByText("Binary files differ")).toBeTruthy();
    expect(screen.getByText(/cannot be represented/)).toBeTruthy();
    view.rerender(<WorkChanges value={{ wrong: "preserve this witness" }} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/preserve this witness/)).toBeTruthy();
    view.rerender(<WorkChanges value={[]} />);
    expect(screen.getByText("No file changes in this conversation.")).toBeTruthy();
  });
});
