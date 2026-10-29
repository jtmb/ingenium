import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  push: vi.fn(), send: vi.fn(), chat: vi.fn(), config: vi.fn(), create: vi.fn(),
  sessionReady: true, isStreaming: false, chatError: null as string | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }), useSearchParams: () => new URLSearchParams("settings=general") }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("../src/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-a" } }) }));
vi.mock("../src/lib/OrganizationContext", () => ({ useOrganization: () => ({ active: { id: "org-a" } }) }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "project-a" }));
vi.mock("../src/lib/RuntimeContext", () => ({ useRuntime: () => ({
  client: { chat: { config: state.config }, sessions: { diff: vi.fn() } },
  runtimeId: "runtime-a", projectName: "project-a", workspace: { confirmedWorkspaceId: "workspace-a", mode: "isolated" },
}) }));
vi.mock("../src/lib/use-opencode-sessions", () => ({ useOpenCodeSessions: () => ({
  sessions: [{ id: "ses-a", title: "First task", model: { id: "model-a", providerID: "provider-a" } }, { id: "ses-b", title: "Second task", model: { id: "model-a", providerID: "provider-a" } }],
  isLoading: false, isCreating: false, create: state.create,
}) }));
vi.mock("../src/lib/use-opencode-chat", () => ({ useOpenCodeChat: (id: string | null) => {
  state.chat(id);
  return { messages: [], sessionReady: state.sessionReady && id !== null, send: state.send,
    isStreaming: state.isStreaming, error: state.chatError, permissions: [], questions: [], stop: vi.fn() };
} }));
vi.mock("../src/app/chat/components/ChatMessages", () => ({ default: () => <p>Transcript owner</p> }));
vi.mock("../src/app/chat/components/ActivityDrawer", () => ({ default: () => null }));
vi.mock("../src/app/components/veyra-work/WorkWebFrame", () => ({ default: ({ sessionId }: { sessionId: string | null }) => <p>Upstream frame: {sessionId}</p> }));
vi.mock("../src/app/components/RuntimeWorkspacePicker", () => ({ default: () => <p>Workspace picker</p> }));

import WorkRuntime from "../src/app/components/veyra-work/WorkRuntime";

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionReady = true; state.isStreaming = false; state.chatError = null;
  state.config.mockResolvedValue({ defaultSelection: { providerId: "provider-a", modelId: "model-a" }, providers: [
    { providerId: "provider-a", label: "Provider A", models: [{ id: "model-a", label: "Model A" }] },
  ] });
  state.send.mockResolvedValue(true);
});
afterEach(cleanup);
const props = { initialSessionId: "ses-a", requestedRuntime: "runtime-a", requestedProject: "project-a" };

describe("Work runtime boundary and conversation state", () => {
  it.each([{ requestedRuntime: "runtime-other" }, { requestedProject: "project-other" }])("refuses another workspace before mounting transcript hooks", (mismatch) => {
    render(<WorkRuntime {...props} {...mismatch} />);
    expect(screen.getByRole("alert").textContent).toContain("another workspace");
    expect(state.chat).not.toHaveBeenCalled(); expect(state.config).not.toHaveBeenCalled();
  });

  it("does not hydrate an unlisted explicit session or fall back to a recent task", async () => {
    render(<WorkRuntime {...props} initialSessionId="ses-missing" />);
    await screen.findByRole("alert");
    expect(state.chat.mock.calls.every(([id]) => id === null)).toBe(true);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preserves each exact draft through history changes and the Web presentation", async () => {
    const view = render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "First task original draft" } });
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-b" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second task draft" } });
    view.rerender(<WorkRuntime {...props} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("First task original draft");
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    expect(screen.getByText("Upstream frame: ses-a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("First task original draft");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("retains failed sends without automatic replay and clears only acknowledged submissions", async () => {
    state.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Exact original prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Exact original prompt");
    await waitFor(() => expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
    expect(state.send).toHaveBeenLastCalledWith([{ type: "text", text: "Exact original prompt" }], { model: { providerID: "provider-a", modelID: "model-a" } });
  });

  it("moves the pre-session draft only after New chat returns a confirmed identity", async () => {
    state.create.mockResolvedValue("ses-a");
    const view = render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft before session creation" } });
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/work?settings=general&session=ses-a&runtime=runtime-a&project=project-a", { scroll: false }));
    view.rerender(<WorkRuntime {...props} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft before session creation");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("blocks send when the legacy controller marks a failed history load as sessionReady", async () => {
    state.chatError = "Failed to load messages";
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Must wait for authoritative history" } });
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("keeps the exact original and first failure when admission throws, without replay", async () => {
    state.send.mockRejectedValueOnce(new Error("Connection lost before acknowledgement"));
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Do not replay this prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(/Connection lost before acknowledgement/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Do not replay this prompt");
    expect(state.send).toHaveBeenCalledTimes(1);
  });
});
