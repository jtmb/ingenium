import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("../src/lib/RuntimeContext", () => ({ useRuntime: () => ({ client: {}, runtimeId: "current-runtime", projectName: "current-project", workspace: {} }) }));
vi.mock("../src/app/chat/components/ChatShell", () => ({ default: ({ initialSessionId }: { initialSessionId: string | null }) => <p data-testid="opened-chat">{initialSessionId}</p> }));
vi.mock("../src/app/components/RuntimeWorkspacePicker", () => ({ default: () => <button type="button">Choose workspace</button> }));

import ChatPage from "../src/app/chat/page";

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
});
