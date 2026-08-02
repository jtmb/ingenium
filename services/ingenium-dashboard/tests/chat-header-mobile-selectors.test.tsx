import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { useState } from "react";
import ChatHeader from "../src/app/chat/components/ChatHeader";

const baseProps = {
  sessionTitle: "Chat",
  onRename: vi.fn(),
  onFork: vi.fn(),
  onShare: vi.fn(),
  onCompact: vi.fn(),
  providerId: "provider-a",
  modelId: "model-a",
  agentName: "ingenium-chat",
  onProviderChange: vi.fn(),
  onModelChange: vi.fn(),
  onAgentChange: vi.fn(),
  providers: [
    { id: "provider-a", label: "Provider A" },
    { id: "provider-b", label: "Provider B" },
  ],
  availableModels: [
    { id: "model-a", label: "Model A" },
    { id: "model-b", label: "Model B" },
  ],
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  isBusy: false,
  onMobileMenuOpen: vi.fn(),
};

describe("ChatHeader mobile selectors", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps provider and model selectors available in a horizontally scrollable mobile row", () => {
    render(<ChatHeader {...baseProps} />);

    expect(screen.getByRole("banner").className).toContain("min-w-0");
    const createTask = screen.getByRole("button", { name: "Create task from conversation" });
    expect(createTask.className).toContain("min-h-11");
    expect(createTask.className).toContain("min-w-11");

    const mobileRow = screen.getByTestId("chat-header-mobile-selectors");
    expect(mobileRow.className).toContain("overflow-x-auto");
    expect(screen.getByTestId("chat-header-mobile-provider").className).toContain("shrink-0");
    expect(screen.getByTestId("chat-header-mobile-model").className).toContain("shrink-0");

    for (const testId of [
      "chat-header-provider",
      "chat-header-model",
      "chat-header-agent",
      "chat-header-mobile-provider",
      "chat-header-mobile-model",
      "chat-header-mobile-agent",
    ]) {
      const select = screen.getByTestId(testId);
      expect(select.tagName).toBe("SELECT");
      expect(select.className).toContain("appearance-none");
      expect(select.className).toContain("rounded-md");
      expect(select.className).toContain("pr-7");
      expect(select.parentElement?.className).toContain("relative");
      expect(select.parentElement?.className).toContain("shrink-0");
      expect(select.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }

    expect(mobileRow.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);

    fireEvent.change(screen.getByTestId("chat-header-mobile-provider"), {
      target: { value: "provider-b" },
    });
    fireEvent.change(screen.getByTestId("chat-header-mobile-model"), {
      target: { value: "model-b" },
    });

    expect(baseProps.onProviderChange).toHaveBeenCalledWith("provider-b");
    expect(baseProps.onModelChange).toHaveBeenCalledWith("model-b");
  });

  it("keeps variant selectors native with the shared Select treatment on desktop and mobile", () => {
    render(
      <ChatHeader
        {...baseProps}
        variant="balanced"
        onVariantChange={vi.fn()}
        availableModels={[{
          id: "model-a",
          label: "Model A",
          variants: { balanced: {}, fast: {} },
        }]}
      />,
    );

    for (const testId of ["chat-header-variant", "chat-header-mobile-variant"]) {
      const select = screen.getByTestId(testId);
      expect(select.tagName).toBe("SELECT");
      expect(select.className).toContain("appearance-none");
      expect(select.className).toContain("rounded-md");
      expect(select.className).toContain("pr-7");
      expect(select.parentElement?.className).toContain("relative");
      expect(select.parentElement?.className).toContain("shrink-0");
      expect(select.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("disables both mobile selectors while the catalog is unavailable", () => {
    render(<ChatHeader {...baseProps} disabled />);

    expect((screen.getByTestId("chat-header-mobile-provider") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId("chat-header-mobile-model") as HTMLSelectElement).disabled).toBe(true);
  });

  it("recovers the mobile model selector when the provider changes", () => {
    function MobileSelectionHarness() {
      const [selection, setSelection] = useState({ providerId: "provider-a", modelId: "missing-model" });
      const models = selection.providerId === "provider-b"
        ? [{ id: "model-b", label: "Model B" }]
        : [{ id: "model-a", label: "Model A" }];
      return (
        <ChatHeader
          {...baseProps}
          providerId={selection.providerId}
          modelId={selection.modelId}
          availableModels={models}
          modelDisabled={!models.some((model) => model.id === selection.modelId)}
          onProviderChange={(providerId) => setSelection({
            providerId,
            modelId: providerId === "provider-b" ? "model-b" : "model-a",
          })}
        />
      );
    }

    render(<MobileSelectionHarness />);
    const provider = screen.getByTestId("chat-header-mobile-provider") as HTMLSelectElement;
    const model = screen.getByTestId("chat-header-mobile-model") as HTMLSelectElement;
    expect(provider.disabled).toBe(false);
    expect(model.disabled).toBe(true);

    fireEvent.change(provider, { target: { value: "provider-b" } });

    expect(provider.value).toBe("provider-b");
    expect(model.value).toBe("model-b");
    expect(model.disabled).toBe(false);
  });
});
