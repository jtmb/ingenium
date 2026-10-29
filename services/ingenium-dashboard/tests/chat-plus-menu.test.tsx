import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChatInput from "../src/app/chat/components/ChatInput";
import ChatHeader from "../src/app/chat/components/ChatHeader";

afterEach(cleanup);

function setup(busy = false) {
  const callbacks = { rename: vi.fn(), fork: vi.fn(), share: vi.fn(), compact: vi.fn(), task: vi.fn(), mcp: vi.fn(), history: vi.fn(), model: vi.fn() };
  const view = render(<ChatInput onSend={async () => true} onStop={() => {}} isLoading={busy} attachments={[]} onAttachmentsChange={() => {}} memoryWorkspaceId="owned-memory" memoryCanRead memoryCanSave
    renderConversationOptions={close => <ChatHeader presentation="menu" onAction={close} sessionTitle="Review release notes" onRename={callbacks.rename} onFork={callbacks.fork} onShare={callbacks.share} onCompact={callbacks.compact} providerId="openai" modelId="luna" agentName="ingenium-chat" onProviderChange={() => {}} onModelChange={callbacks.model} onAgentChange={() => {}} providers={[{id:"openai",label:"OpenAI"}]} availableModels={[{id:"luna",label:"GPT-6 Luna"},{id:"luna-fast",label:"GPT-6 Luna Fast"}]} agents={[{name:"ingenium-chat",label:"Chat"}]} isBusy={busy} disabled={busy} onMobileMenuOpen={callbacks.history} onMcpOpen={callbacks.mcp} onCreateTask={callbacks.task} createTaskDisabled={busy} />}
  />);
  const trigger = screen.getByRole("button", { name: "Add to conversation" });
  return { ...view, callbacks, trigger };
}

describe("composer plus actions", () => {
  it("exposes conversation actions from plus and keeps the draft when dismissed", () => {
    const { trigger, callbacks } = setup();
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Chat message input" });
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    expect(screen.queryByRole("button", { name: "Fork conversation" })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Add to conversation" })).toBeTruthy();
    for (const name of ["Rename conversation", "Fork conversation", "Share conversation", "Compact conversation", "Create task from conversation", "MCP servers", "Add photos & files"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Compact conversation" }));
    expect(callbacks.share).toHaveBeenCalledTimes(1);
    expect(callbacks.compact).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Add photos & files" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(draft.value).toBe("Keep this draft");
    expect(document.activeElement).toBe(trigger);
  });

  it("preserves rename and advanced model controls", () => {
    const { trigger, callbacks } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Rename conversation" }));
    const title = screen.getByRole("textbox", { name: "Session title" });
    fireEvent.change(title, { target: { value: "Reviewed release notes" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(callbacks.rename).toHaveBeenCalledExactlyOnceWith("Reviewed release notes");
    fireEvent.click(screen.getByText("Model and agent"));
    const model = screen.getByRole<HTMLSelectElement>("combobox", { name: "Select model" });
    expect(model.value).toBe("luna");
    fireEvent.change(model, { target: { value: "luna-fast" } });
    expect(callbacks.model).toHaveBeenCalledExactlyOnceWith("luna-fast");
  });

  it("closes the popover before opening task tools and retains a connected focus target", () => {
    const { trigger, callbacks } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
    expect(callbacks.mcp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(callbacks.history).toHaveBeenCalledExactlyOnceWith(trigger);
    expect(trigger.isConnected).toBe(true);
  });

  it("keeps busy actions disabled while allowing the menu to be inspected", () => {
    const { trigger, callbacks } = setup(true);
    fireEvent.click(trigger);
    for (const name of ["Fork conversation", "Share conversation", "Compact conversation", "Create task from conversation", "Add photos & files"]) {
      const action = screen.getByRole<HTMLButtonElement>("button", { name });
      expect(action.disabled).toBe(true);
      fireEvent.click(action);
    }
    expect(callbacks.fork).not.toHaveBeenCalled();
    expect(callbacks.share).not.toHaveBeenCalled();
    expect(callbacks.compact).not.toHaveBeenCalled();
    expect(callbacks.task).not.toHaveBeenCalled();
  });

  it("keeps attachment selection connected to the original file input", () => {
    const { trigger, container } = setup();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Add photos & files" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
