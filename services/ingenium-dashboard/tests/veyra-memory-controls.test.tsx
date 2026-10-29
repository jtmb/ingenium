import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryControls, type MemoryControlsState } from "../src/app/components/memory-v2/MemoryControls";
import { LearnedMemoryList } from "../src/app/components/memory-v2/LearnedMemoryList";
import { MemoryDisclosure } from "../src/app/components/memory-v2/MemoryDisclosure";
afterEach(cleanup);
const state: MemoryControlsState = { scopeKey: "exact-host-workspace", chatId: "chat-a", available: true, canChange: true, loading: false, pending: false,
  policy: { revision: 2, enabled: true, generate: false, useMemory: true, externalContext: false }, chat: { revision: 3, useMemory: true, contribute: false } };
describe("Scoped memory controls", () => {
  it("sends independent per-chat CAS values with exact captured identity", () => {
    const onChange = vi.fn(); render(<MemoryControls state={state} onChange={onChange} onReconcile={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Allow this chat to contribute"));
    expect(onChange).toHaveBeenCalledWith(state.scopeKey, state.chatId, { target: "chat", expectedRevision: 3, values: { ...state.chat, contribute: true } });
    expect((screen.getByLabelText("Generate learned recall from eligible chats") as HTMLInputElement).checked).toBe(false);
  });
  it("fails closed while unavailable or reconciling an unknown mutation", () => {
    const onChange = vi.fn(), onReconcile = vi.fn();
    const view = render(<MemoryControls state={{ ...state, available: false }} onChange={onChange} onReconcile={onReconcile} />);
    expect((screen.getByLabelText("Use memories in this chat").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    view.rerender(<MemoryControls state={{ ...state, unknownOperationId: "original-op" }} onChange={onChange} onReconcile={onReconcile} />);
    expect((screen.getByLabelText("Allow this chat to contribute").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Check operation status")); expect(onReconcile).toHaveBeenCalledWith("original-op");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("requires a server reset preview and forwards its confirmation token", () => {
    const onConfirmReset = vi.fn();
    render(<LearnedMemoryList scopeLabel="Host A / private workspace" rows={[]} total={4} pending={false} canForget resetPreview={{ scopeHash: "scope", confirmation: "server-token", count: 4 }} onPreviewReset={vi.fn()} onConfirmReset={onConfirmReset} onForget={vi.fn()} />);
    fireEvent.click(screen.getByText("Confirm reset of 4 learned memories"));
    expect(onConfirmReset).toHaveBeenCalledWith("server-token");
    expect(screen.getByText(/Immutable backups/)).toBeTruthy();
  });
  it("discloses included versions, budget omissions and provenance entry point", () => {
    const inspect = vi.fn();
    render(<MemoryDisclosure included={[{ id: "recall-a", version: 2 }]} omitted={[{ id: "recall-b", reason: "budget" }]} estimatedTokens={42} onInspect={inspect} />);
    expect(screen.getByText("recall-b: budget")).toBeTruthy();
    fireEvent.click(screen.getByText("Inspect memories and provenance")); expect(inspect).toHaveBeenCalledOnce();
  });
});
