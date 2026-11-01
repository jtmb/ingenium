import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), query: "settings=general", send: vi.fn(), chat: vi.fn(), config: vi.fn(), create: vi.fn(),
  sessionReady: true, isStreaming: false, chatError: null as string | null,
  nativeVariant: "", extraSessions: [] as Array<{ id: string; title: string }>,
  connected: true, stopWorkspace: vi.fn(),
  messages: [] as Array<{ id: string; role: "user" | "assistant"; content: string; parts: []; timestamp: number }>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/work", useRouter: () => ({ push: state.push, replace: state.replace }), useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("next/image", () => ({ default: () => null }));
// Preserve the real Link's accessibility attributes when replacing its router.
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("../src/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-a" } }) }));
vi.mock("../src/lib/OrganizationContext", () => ({ useOrganization: () => ({ active: { id: "org-a" } }) }));
vi.mock("../src/lib/ProjectContext", () => ({ useOptionalProject: () => "project-a" }));
vi.mock("../src/lib/RuntimeContext", () => {
  const client = { chat: { config: state.config }, sessions: { diff: vi.fn() } };
  return { useRuntime: () => ({
  client: state.connected ? client : null,
  runtimeId: "runtime-a", projectName: "project-a", workspace: { confirmedWorkspaceId: "workspace-a", mode: "isolated",canStop:true,stop:state.stopWorkspace },
}) }; });
vi.mock("../src/lib/use-opencode-sessions", () => ({ useOpenCodeSessions: () => ({
  sessions: [{ id: "ses-a", title: "First task", model: { id: "model-a", providerID: "provider-a", variant: state.nativeVariant || undefined } }, { id: "ses-b", title: "Second task", model: { id: "model-a", providerID: "provider-a" } }, ...state.extraSessions],
  isLoading: false, isCreating: false, create: state.create,
}) }));
vi.mock("../src/lib/use-opencode-chat", () => ({ useOpenCodeChat: (id: string | null) => {
  state.chat(id);
  const ready = state.sessionReady && id !== null;
  return { messages: ready ? state.messages : [], sessionReady: ready, isLoading: id !== null && !ready, send: state.send,
    isStreaming: state.isStreaming, error: state.chatError, permissions: [], questions: [], stop: vi.fn() };
} }));
vi.mock("../src/app/chat/components/ChatMessages", () => ({ default: ({ messages }: { messages: Array<{ id: string; content: string }> }) =>
  messages.length ? <div data-testid="transcript-scroll">{messages.map((message) => <p key={message.id}>{message.content}</p>)}</div> : <p>Transcript owner</p> }));
vi.mock("../src/app/chat/components/ActivityDrawer", () => ({ default: () => null }));
vi.mock("../src/app/components/veyra-work/WorkWebFrame", () => ({ default: ({ sessionId }: { sessionId: string | null }) => <p>Upstream frame: {sessionId}</p> }));
vi.mock("../src/app/components/RuntimeWorkspacePicker", () => ({ default: () => <p>Workspace picker</p> }));

// Project catalog has its own genuine actor/scope and lifecycle mounted tests.
vi.mock("../src/app/components/projects-v2/HostedWorkspaceProjects", () => ({default: () => <span>Actor project catalog</span>}));

import WorkRuntime from "../src/app/components/veyra-work/WorkRuntime";

beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockReset(); state.send.mockReset(); state.create.mockReset();
  state.sessionReady = true; state.isStreaming = false; state.chatError = null; state.query = "settings=general";
  state.nativeVariant = ""; state.extraSessions = []; state.connected = true; state.messages = [];
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

  it("keeps an unknown admission blocked through Work/Web return without replay", async () => {
    state.send.mockResolvedValueOnce(false);
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Exact original prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Exact original prompt");
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    await waitFor(() => expect(screen.getByText(/This submission was not confirmed/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(state.send).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Exact original prompt");
  });

  it("clears only a positively acknowledged prompt", async () => {
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acknowledged exact prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
    expect(state.send).toHaveBeenLastCalledWith([{ type: "text", text: "Acknowledged exact prompt" }], { model: { providerID: "provider-a", modelID: "model-a" } });
  });

  it("moves the pre-session draft only after New chat returns a confirmed identity", async () => {
    state.create.mockImplementation(async () => { state.extraSessions.push({ id: "ses-new", title: "Created task" }); return "ses-new"; });
    const view = render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft before session creation" } });
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/work?settings=general&session=ses-new&runtime=runtime-a&project=project-a", { scroll: false }));
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-new" />);
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

  it("fills a contextual suggestion only into the draft, without admission or replacing existing text", async () => {
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.click(screen.getByRole("button", { name: "Assess the next step" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("Assess the current task");
    expect(state.send).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation", { name: "Suggested next steps" })).toBeNull();
  });

  it("opens Settings in place with the existing scoped query and retains the Work draft", async () => {
    state.query = "session=ses-a&runtime=runtime-a&project=project-a";
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retain draft while configuring" } });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(state.replace).toHaveBeenCalledWith("/work?session=ses-a&runtime=runtime-a&project=project-a&settings=general", { scroll: false });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Retain draft while configuring");
    expect(screen.getByRole("link", { name: "Customize" }).getAttribute("href")).toBe("/customize/plugins");
  });

  it("refreshes fresh defaults without losing draft text or changing an existing unavailable native model", async () => {
    const nextConfig = { defaultSelection: { providerId: "provider-b", modelId: "model-b", variant: "medium" }, providers: [
      { providerId: "provider-b", label: "Provider B", models: [{ id: "model-b", label: "Model B", variants: { medium: {} } }] },
    ] };
    const view = render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-a","model-a"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this unsent draft" } });
    state.config.mockResolvedValue(nextConfig);
    fireEvent(window, new Event("veyra-chat-defaults-changed"));
    await waitFor(() => expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-b","model-b"]'));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this unsent draft");
    expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("medium");
    view.rerender(<WorkRuntime {...props} />);
    expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-a","model-a"]');
    expect(screen.getByRole("option", { name: "Unavailable: provider-a / model-a" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retains native effort and refreshes supported choices, without applying new default effort", async () => {
    state.nativeVariant = "high";
    state.config.mockResolvedValue({ defaultSelection: { providerId: "provider-a", modelId: "model-a", variant: "medium" }, providers: [
      { providerId: "provider-a", label: "Provider A", models: [{ id: "model-a", label: "Model A", variants: { high: {}, medium: {} } }] },
    ] });
    render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "high" })).toBeTruthy());
    expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("high");
    fireEvent(window, new Event("veyra-chat-defaults-changed"));
    await waitFor(() => expect(state.config).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("high");
  });

  it("recovers unknown defaults by a read without creating or selecting a substitute session", async () => {
    state.config.mockRejectedValueOnce(new Error("Defaults unavailable"));
    render(<WorkRuntime {...props} initialSessionId={null} />);
    await screen.findByRole("button", { name: "Reload model configuration" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Preserve before recovery" } });
    expect((screen.getByRole("button", { name: /New chat/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload model configuration" }));
    await waitFor(() => expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-a","model-a"]'));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Preserve before recovery");
    expect(state.create).not.toHaveBeenCalled(); expect(state.push).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects a reused creation identity and retains the original without a second creation", async () => {
    state.create.mockResolvedValue("ses-a");
    render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect((screen.getByRole("button", { name: /New chat/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Do not overwrite an existing task" } });
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    await screen.findByText(/Creation returned an existing conversation identity/);
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.push).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Do not overwrite an existing task");
  });

  it("honors a parent pending-admission block and renders its existing controller without sending", async () => {
    render(<WorkRuntime {...props} submissionBlockedReason="Resolve the retained native original first." admissionControl={<button type="button">Read native admission</button>} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retain while native controller checks" } });
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /New chat/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Read native admission" })).toBeTruthy();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("keeps navigation and the parent admission witness available when disconnected", () => {
    state.connected = false;
    render(<WorkRuntime {...props} admissionControl={<p>Retained native original</p>} />);
    expect(screen.getByText("Workspace picker")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Customize" }).getAttribute("href")).toBe("/customize/plugins");
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Retained native original")).toBeTruthy();
    expect(state.config).not.toHaveBeenCalled(); expect(state.chat).not.toHaveBeenCalled();
  });

  it("seeds a newly created session from installation defaults rather than the prior chat choice", async () => {
    state.config.mockResolvedValue({ defaultSelection: { providerId: "provider-b", modelId: "model-b", variant: "medium" }, providers: [
      { providerId: "provider-a", label: "Provider A", models: [{ id: "model-a", label: "Model A" }] },
      { providerId: "provider-b", label: "Provider B", models: [{ id: "model-b", label: "Model B", variants: { medium: {} } }] },
    ] });
    state.create.mockImplementation(async () => { state.extraSessions.push({ id: "ses-new", title: "Created task" }); return "ses-new"; });
    const view = render(<WorkRuntime {...props} />);
    await waitFor(() => expect((screen.getByRole("button", { name: /New chat/ }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-a","model-a"]');
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    await waitFor(() => expect(state.push).toHaveBeenCalled());
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-new" />);
    expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-b","model-b"]');
    expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("medium");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("renders only the parent controls matching the exact actor, workspace and selected conversation", async () => {
    const binding = { ownerId: "owner-a", organizationId: "org-a", projectId: "canonical-project-a", runtimeId: "runtime-a", workspaceId: "workspace-a", sessionId: "ses-a" };
    const startVoice = vi.fn();
    const slots = { binding, voiceControl: <button type="button" onClick={startVoice}>Call selected agent</button>,
      memoryControl: <button type="button">Memory policy</button>, dot: <button type="button">veyra-bot</button>, panels: <p>Bound domain panel</p> };
    const view = render(<WorkRuntime {...props} projectRefId="canonical-project-a" contextSlots={slots} />);
    await screen.findByRole("button", { name: "Call selected agent" });
    fireEvent.click(screen.getByRole("button", { name: "Call selected agent" }));
    expect(startVoice).toHaveBeenCalledTimes(1); expect(state.send).not.toHaveBeenCalled();
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-b" projectRefId="canonical-project-a" contextSlots={slots} />);
    expect(screen.queryByRole("button", { name: "Call selected agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Memory policy" })).toBeNull();
    expect(screen.queryByText("Bound domain panel")).toBeNull();
    expect(screen.getByText(/Waiting for controls/)).toBeTruthy();
  });

  it("does not add history for the selected conversation or overwrite a newer Back/Forward URL", async () => {
    state.query = "session=ses-a&runtime=runtime-a&project=project-a";
    const view = render(<WorkRuntime {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.click(screen.getAllByRole("button", { name: "First task" })[0]!);
    expect(state.push).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
    state.query = "session=ses-b&runtime=runtime-a&project=project-a";
    view.rerender(<WorkRuntime {...props} />);
    expect(state.replace).not.toHaveBeenCalled();
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-b" />);
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.chat).toHaveBeenLastCalledWith("ses-b");
  });

  it("keeps malformed route identity out of all conversation hooks and offers explicit navigation", () => {
    render(<WorkRuntime {...props} routeError="The Work URL contains a repeated session value." />);
    expect(screen.getByRole("alert").textContent).toContain("repeated session");
    expect(screen.getByRole("link", { name: "Choose a conversation in Work" }).getAttribute("href")).toBe("/work");
    expect(state.chat).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled(); expect(state.config).not.toHaveBeenCalled();
  });

  it("does not reinterpret an unavailable explicit session as the new-session domain controls", async () => {
    render(<WorkRuntime {...props} initialSessionId="ses-missing" projectRefId="canonical-project-a" contextSlots={{
      binding: { ownerId: "owner-a", organizationId: "org-a", projectId: "canonical-project-a", runtimeId: "runtime-a", workspaceId: "workspace-a", sessionId: null },
      voiceControl: <button type="button">Start a new voice session</button>,
    }} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Start a new voice session" })).toBeNull();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("requires an explicit canonical project ref and distinguishes project organization on the same execution binding", () => {
    const slots = { binding: { ownerId: "owner-a", organizationId: "org-a", projectId: "canonical-project-a", runtimeId: "runtime-a", workspaceId: "workspace-a", sessionId: "ses-a" },
      memoryControl: <button type="button">Bound memory policy</button> };
    const view = render(<WorkRuntime {...props} contextSlots={slots} />);
    expect(screen.queryByRole("button", { name: "Bound memory policy" })).toBeNull();
    view.rerender(<WorkRuntime {...props} projectRefId="" contextSlots={slots} />);
    expect(screen.queryByRole("button", { name: "Bound memory policy" })).toBeNull();
    view.rerender(<WorkRuntime {...props} projectRefId="canonical-project-b" contextSlots={slots} />);
    expect(screen.queryByRole("button", { name: "Bound memory policy" })).toBeNull();
    view.rerender(<WorkRuntime {...props} projectRefId="canonical-project-a" contextSlots={slots} />);
    expect(screen.getByRole("button", { name: "Bound memory policy" })).toBeTruthy();
  });

  it("isolates canonical project drafts without substituting the project label into the API route binding", async () => {
    state.query = "session=ses-a&runtime=runtime-a&project=project-a";
    const view = render(<WorkRuntime {...props} projectRefId="canonical-project-a" projectDisplayName="Display A" />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Project A original draft" } });
    view.rerender(<WorkRuntime {...props} projectRefId="canonical-project-b" projectDisplayName="Display B" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(state.replace).not.toHaveBeenCalled();
    view.rerender(<WorkRuntime {...props} projectRefId="canonical-project-a" projectDisplayName="Renamed A" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Project A original draft");
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("first Send creates one session, waits for that exact history and submits the captured text/file/model/effort once", async () => {
    state.config.mockResolvedValue({ defaultSelection: { providerId: "provider-a", modelId: "model-a", variant: "high" }, providers: [
      { providerId: "provider-a", label: "Provider A", models: [{ id: "model-a", label: "Model A", variants: { high: {} } }] },
    ] });
    state.create.mockImplementation(async () => { state.extraSessions.push({ id: "ses-first", title: "Created first send" }); return "ses-first"; });
    const view = render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("high"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Captured first prompt" } });
    fireEvent.change(screen.getByLabelText("Choose Work attachments"), { target: { files: [new File(["exact context"], "notes.txt", { type: "text/plain" })] } });
    await screen.findByRole("button", { name: "Remove notes.txt" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(false));
    state.sessionReady = false;
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/work?settings=general&session=ses-first&runtime=runtime-a&project=project-a", { scroll: false }));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.send).not.toHaveBeenCalled();
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-first" />);
    expect(state.send).not.toHaveBeenCalled();
    state.config.mockResolvedValue({ defaultSelection: { providerId: "provider-b", modelId: "model-b", variant: "medium" }, providers: [
      { providerId: "provider-a", label: "Provider A", models: [{ id: "model-a", label: "Model A", variants: { high: {} } }] },
      { providerId: "provider-b", label: "Provider B", models: [{ id: "model-b", label: "Model B", variants: { medium: {} } }] },
    ] });
    fireEvent(window, new Event("veyra-chat-defaults-changed"));
    await screen.findByRole("option", { name: "Provider B / Model B" });
    expect((screen.getByLabelText("Work model") as HTMLSelectElement).value).toBe('["provider-a","model-a"]');
    state.sessionReady = true;
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-first" />);
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send).toHaveBeenCalledWith([
      { type: "text", text: "Captured first prompt" },
      { type: "file", mime: "text/plain", url: expect.stringContaining("data:text/plain;base64,"), filename: "notes.txt" },
    ], { model: { providerID: "provider-a", modelID: "model-a" }, variant: "high" });
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
  });

  it("preserves the captured first draft and never creates again when creation acknowledgement is lost", async () => {
    state.create.mockResolvedValue(null);
    render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "First draft with unknown creation" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(/First-send creation or preparation was not confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.send).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("First draft with unknown creation");
  });

  it("does not resend a first prompt after unknown admission or a Work/Web round trip", async () => {
    state.create.mockImplementation(async () => { state.extraSessions.push({ id: "ses-first", title: "Created first send" }); return "ses-first"; });
    state.send.mockResolvedValue(false);
    const view = render(<WorkRuntime {...props} initialSessionId={null} />);
    await waitFor(() => expect(screen.getByLabelText("Work model").textContent).toContain("Model A"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep first admission original" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(state.push).toHaveBeenCalled());
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-first" />);
    await screen.findByText(/First-send admission needs review in conversation ses-first/);
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep first admission original");
  });

  it("retains the last rendered transcript node and scroll while authoritative history reloads after Web", async () => {
    const original = { id: "message-a", role: "user" as const, content: "Previously confirmed history", parts: [] as [], timestamp: 1 };
    state.messages = [original];
    const view = render(<WorkRuntime {...props} />);
    await screen.findByText(original.content);
    const scroll = screen.getByTestId("transcript-scroll"); scroll.scrollTop = 120;
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    state.sessionReady = false;
    view.rerender(<WorkRuntime {...props} />);
    expect(screen.getByText(original.content)).toBeTruthy();
    expect(screen.getByTestId("transcript-scroll")).toBe(scroll); expect(scroll.scrollTop).toBe(120);
    state.messages = [original, { id: "message-b", role: "assistant", content: "Authoritative Web update", parts: [], timestamp: 2 }];
    state.sessionReady = true;
    view.rerender(<WorkRuntime {...props} />);
    await screen.findByText("Authoritative Web update");
    expect(screen.getByTestId("transcript-scroll")).toBe(scroll); expect(scroll.scrollTop).toBe(120);
  });

  it("labels a failed refresh as a previous read-only view, blocks sends and never shows it in another session", async () => {
    state.messages = [{ id: "message-a", role: "user", content: "Retain this scoped history", parts: [], timestamp: 1 }];
    const view = render(<WorkRuntime {...props} />);
    await screen.findByText("Retain this scoped history");
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    state.sessionReady = false;
    view.rerender(<WorkRuntime {...props} />);
    state.chatError = "History unavailable"; state.sessionReady = true;
    view.rerender(<WorkRuntime {...props} />);
    await screen.findByText(/History refresh failed. Showing the previous read-only history/);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    state.messages = []; state.sessionReady = false;
    view.rerender(<WorkRuntime {...props} initialSessionId="ses-b" />);
    expect(screen.queryByText("Retain this scoped history")).toBeNull();
    expect(state.send).not.toHaveBeenCalled();
  });
});

it('workspace stop is available in the existing environment menu for an empty settled draft',async()=>{render(<WorkRuntime {...props}/>);await waitFor(()=>expect(state.config).toHaveBeenCalled());fireEvent.click(screen.getByText('Isolated runtime'));const stop=await screen.findByRole('button',{name:'Stop workspace'});await waitFor(()=>expect((stop as HTMLButtonElement).disabled).toBe(false));fireEvent.click(stop);expect(state.stopWorkspace).toHaveBeenCalledTimes(1)});
it('workspace stop protects unsent text and active streaming',async()=>{const mounted=render(<WorkRuntime {...props}/>);await waitFor(()=>expect(state.config).toHaveBeenCalled());fireEvent.click(screen.getByText('Isolated runtime'));const input=screen.getByRole('textbox',{name:'Message the working agent'});fireEvent.change(input,{target:{value:'Keep this exact draft'}});expect((screen.getByRole('button',{name:'Stop workspace'})as HTMLButtonElement).disabled).toBe(true);fireEvent.change(input,{target:{value:''}});state.isStreaming=true;mounted.rerender(<WorkRuntime {...props}/>);expect((screen.getByRole('button',{name:'Stop workspace'})as HTMLButtonElement).disabled).toBe(true)});
