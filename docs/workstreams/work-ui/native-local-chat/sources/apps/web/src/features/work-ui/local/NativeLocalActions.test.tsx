import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeWorkNoProjectActions } from "../NativeWorkNoProjectActions";

afterEach(cleanup);
describe("explicit local start composition", () => {
  it("routes New chat solely to the local owner and never creates a scratch Project", () => {
    const local = vi.fn(), scratch = vi.fn();
    render(<NativeWorkNoProjectActions localAvailable onStartLocalChat={local} scratchAvailable creating={false} resumable={false} onCreateScratch={scratch} />);
    fireEvent.click(screen.getByRole("button", { name: "New chat", exact: true }));
    expect(local).toHaveBeenCalledTimes(1); expect(scratch).not.toHaveBeenCalled();
  });
  it("preserves unavailable local New chat while keeping scratch creation an explicit separate choice", () => {
    const local = vi.fn(), scratch = vi.fn();
    render(<NativeWorkNoProjectActions localAvailable={false} onStartLocalChat={local} scratchAvailable creating={false} resumable={false} onCreateScratch={scratch} />);
    fireEvent.click(screen.getByRole("button", { name: "New chat", exact: true }));
    expect(local).not.toHaveBeenCalled(); expect(scratch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Start options"));
    fireEvent.click(screen.getByRole("button", { name: "Create scratch project" }));
    expect(scratch).toHaveBeenCalledTimes(1); expect(local).not.toHaveBeenCalled();
  });
});
