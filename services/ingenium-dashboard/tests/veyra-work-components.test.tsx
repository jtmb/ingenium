// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkShell from "../src/app/components/veyra-work/WorkShell";
import WorkComposer from "../src/app/components/veyra-work/WorkComposer";
import { emptyWorkDraft } from "../src/app/components/veyra-work/work-state";

vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
vi.mock("../src/app/components/settings/SettingsLauncher", () => ({ default: () => <button type="button">Settings</button> }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Work presentation", () => {
  it("retains composer text and mounted conversation across Web switches; launches Web lazily", () => {
    const mounted = vi.fn(); const removed = vi.fn();
    function Conversation() { useEffect(() => { mounted(); return removed; }, []); return <p>Authoritative transcript</p>; }
    function Composer() { const [text, setText] = useState(""); return <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />; }
    render(<WorkShell projectLabel="Example workspace" projects={[]} conversations={[]} activeId="ses-a"
      onSelect={vi.fn()} onNew={vi.fn()} composer={<Composer />} web={<p>Unchanged upstream</p>}><Conversation /></WorkShell>);
    expect(screen.queryByText("Unchanged upstream")).toBeNull();
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Preserve this exact draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    expect(screen.getByText("Unchanged upstream")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Web", exact: true }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Work", exact: true }));
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Preserve this exact draft");
    expect(mounted).toHaveBeenCalledTimes(1); expect(removed).not.toHaveBeenCalled();
  });

  it("filters conversations and sends the exact chosen identity", () => {
    const select = vi.fn();
    render(<WorkShell projectLabel="Example" projects={[]} conversations={[{ id: "ses-a", title: "Repair keyboard focus" }, { id: "ses-b", title: "Update docs" }]}
      activeId="ses-a" onSelect={select} onNew={vi.fn()} composer={null} web={null}>{null}</WorkShell>);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "keyboard" } });
    expect(screen.queryByRole("button", { name: "Update docs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Repair keyboard focus" }));
    expect(select).toHaveBeenCalledWith("ses-a");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No matching chats.")).toBeTruthy();
  });

  it("starts with a usable narrow canvas and offers keyboard sidebar width controls", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<WorkShell projectLabel="Example" projects={[]} conversations={[]} activeId={null}
      onSelect={vi.fn()} onNew={vi.fn()} composer={null} web={null}>{null}</WorkShell>);
    expect(screen.queryByRole("complementary", { name: "Projects and conversations" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle conversation sidebar" }));
    const width = screen.getByRole("separator", { name: "Conversation sidebar width" });
    expect(width.getAttribute("aria-valuenow")).toBe("468");
    fireEvent.keyDown(width, { key: "Home" });
    expect(width.getAttribute("aria-valuenow")).toBe("256");
    fireEvent.keyDown(width, { key: "ArrowRight" });
    expect(width.getAttribute("aria-valuenow")).toBe("360");
  });
});

describe("Work composer", () => {
  const model = { providerId: "provider", modelId: "model", label: "Configured model", variants: ["medium", "high"] };
  const draft = { ...emptyWorkDraft(), providerId: "provider", modelId: "model", text: "Explain the failing test" };
  it("blocks nonhydrated and pending sends; keeps Shift+Enter and IME composition local", () => {
    const send = vi.fn();
    const props = { draft, onChange: vi.fn(), onSend: send, onStop: vi.fn(), ready: false, pending: false, streaming: false, models: [model] };
    const view = render(<WorkComposer {...props} />);
    fireEvent.submit(screen.getByRole("form", { name: "Work composer" }));
    expect(send).not.toHaveBeenCalled();
    view.rerender(<WorkComposer {...props} ready />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    view.rerender(<WorkComposer {...props} ready pending />);
    fireEvent.submit(screen.getByRole("form", { name: "Work composer" }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops streaming and never presents unsupported reasoning variants", () => {
    const stop = vi.fn();
    render(<WorkComposer draft={draft} onChange={vi.fn()} onSend={vi.fn()} onStop={stop} ready pending={false}
      streaming models={[{ ...model, variants: undefined }]} />);
    expect(screen.queryByLabelText("Reasoning effort")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  });

  it("shows the exact unavailable model/effort and blocks even an incorrectly ready caller", () => {
    const send = vi.fn();
    const view = render(<WorkComposer draft={{ ...draft, modelId: "retained-native", variant: "removed-effort" }} onChange={vi.fn()}
      onSend={send} onStop={vi.fn()} ready pending={false} streaming={false} models={[model]} />);
    expect(screen.getByRole("option", { name: "Unavailable: provider / retained-native" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Unavailable effort: removed-effort" })).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "Work composer" }));
    expect(send).not.toHaveBeenCalled();
    view.rerender(<WorkComposer draft={{ ...draft, variant: "removed-effort" }} onChange={vi.fn()} onSend={send} onStop={vi.fn()}
      ready pending={false} streaming={false} models={[model]} />);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
