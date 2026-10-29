import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "current-project" }));
vi.mock("../src/lib/RuntimeContext", () => ({ useRuntime: () => ({ client: {}, runtimeId: "current-runtime", projectName: "current-project", workspace: {} }) }));
vi.mock("../src/app/chat/components/ChatShell", () => ({ default: ({ initialSessionId, onActiveSessionChange }: { initialSessionId: string | null; onActiveSessionChange: (id: string | null) => void }) => <>
  <p data-testid="opened-chat">{initialSessionId}</p>
  <button onClick={() => onActiveSessionChange("new/session")}>Select another conversation</button>
  <button onClick={() => onActiveSessionChange(initialSessionId)}>Confirm current conversation</button>
  <button onClick={() => onActiveSessionChange(null)}>Clear deleted conversation</button>
</> }));
vi.mock("../src/app/components/RuntimeWorkspacePicker", () => ({ default: () => <button type="button">Choose workspace</button> }));

import ChatPage from "../src/app/chat/page";

beforeEach(() => { state.push.mockClear(); state.replace.mockClear(); });
afterEach(cleanup);
describe("explicit conversation runtime boundary", () => {
  it.each(["another-runtime", ""])("refuses explicit runtime %j before mounting a conversation", runtime => {
    state.query = new URLSearchParams({ session: "exact-session", runtime }).toString();
    render(<ChatPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("different runtime");
    expect(screen.getByRole("button", { name: "Choose workspace" })).toBeVisible();
    expect(screen.queryByTestId("opened-chat")).toBeNull();
  });

  it("passes the exact session only to its matching runtime", () => {
    state.query = "session=exact-session&runtime=current-runtime";
    render(<ChatPage />);
    expect(screen.getByTestId("opened-chat")).toHaveTextContent("exact-session");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("pushes a selected session while preserving scoped and unrelated query values", () => {
    state.query = "session=old-session&runtime=current-runtime&project=current-project&settings=providers";
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select another conversation" }));
    expect(state.push).toHaveBeenCalledWith("/chat?session=new%2Fsession&runtime=current-runtime&project=current-project&settings=providers", { scroll: false });
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("canonicalizes an unlinked selection without adding a browser history entry", () => {
    state.query = "settings=providers";
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select another conversation" }));
    expect(state.replace).toHaveBeenCalledWith("/chat?settings=providers&session=new%2Fsession&runtime=current-runtime&project=current-project", { scroll: false });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("does not navigate again for an already exact session URL", () => {
    state.query = "session=exact-session&runtime=current-runtime&project=current-project";
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm current conversation" }));
    expect(state.push).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("replaces a deleted selection without dropping its workspace", () => {
    state.query = "session=deleted&runtime=current-runtime&project=current-project";
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: "Clear deleted conversation" }));
    expect(state.replace).toHaveBeenCalledWith("/chat?runtime=current-runtime&project=current-project", { scroll: false });
  });
});
