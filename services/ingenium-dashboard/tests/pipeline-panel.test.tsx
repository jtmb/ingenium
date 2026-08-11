import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const { getProviderConfigs, saveProviderConfigs } = vi.hoisted(() => ({
  getProviderConfigs: vi.fn(),
  saveProviderConfigs: vi.fn(),
}));

const { listProviders, listIntegrations, connectKey, beginOAuth, cancelAttempt, disconnect } = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listIntegrations: vi.fn(),
  connectKey: vi.fn(),
  beginOAuth: vi.fn(),
  cancelAttempt: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    settings: {
      getProviderConfigs,
      saveProviderConfigs,
      get: vi.fn().mockResolvedValue({ data: { value: "900000" } }),
      set: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
}));

vi.mock("../src/lib/opencode", () => ({
  opencode: {
    providers: { list: listProviders },
    integrations: {
      list: listIntegrations,
      connectKey,
      beginOAuth,
      attemptStatus: vi.fn(),
      completeAttempt: vi.fn(),
      cancelAttempt,
    },
    auth: { disconnect },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => ({ project: "global-default", loading: false, error: null }),
}));

import PipelinePanel from "../src/app/components/settings/panels/PipelinePanel";
import Overlay from "../src/app/components/Overlay";

const providerFixture = [
  {
    id: "openai-main",
    name: "OpenAI Main",
    npm: "@ai-sdk/openai",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4.1", "gpt-4.1-mini"],
    defaultModel: "gpt-4.1",
    roles: ["available", "primary"],
    enabled: true,
    apiKeySet: true,
  },
  {
    id: "anthropic-backup",
    name: "Anthropic Backup",
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-6"],
    defaultModel: "claude-sonnet-4-6",
    roles: ["available", "backup"],
    enabled: true,
    apiKeySet: true,
  },
  {
    id: "deepseek-extra",
    name: "DeepSeek Extra",
    npm: "@ai-sdk/deepseek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat"],
    defaultModel: "deepseek-chat",
    roles: ["available"],
    enabled: true,
    apiKeySet: false,
  },
];

beforeEach(() => {
  getProviderConfigs.mockResolvedValue({ data: { providers: providerFixture } });
  saveProviderConfigs.mockResolvedValue({ data: { saved: true, warnings: [] } });
  listProviders.mockResolvedValue({
    providers: [
      {
        id: "deepseek",
        label: "DeepSeek",
        models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }, { id: "deepseek-reasoner", label: "DeepSeek Reasoner" }],
        defaultModel: "deepseek-chat",
        connected: false,
      },
      {
        id: "openai",
        label: "OpenAI",
        models: [{ id: "gpt-5", label: "GPT-5" }],
        defaultModel: "gpt-5",
        connected: false,
      },
    ],
  });
  listIntegrations.mockResolvedValue({
    data: [
      { id: "deepseek", name: "DeepSeek", methods: [{ type: "key" }], connections: [] },
      { id: "openai", name: "OpenAI", methods: [{ type: "key" }, { id: "chatgpt-browser", type: "oauth", label: "ChatGPT Pro/Plus (browser)" }], connections: [] },
    ],
  });
  connectKey.mockResolvedValue(undefined);
  cancelAttempt.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("provider block panel", () => {
  it("renders every configured provider as an independent block", async () => {
    render(<PipelinePanel />);

    expect(await screen.findByText("OpenAI Main")).not.toBeNull();
    expect(screen.getByText("Anthropic Backup")).not.toBeNull();
    expect(screen.getByText("DeepSeek Extra")).not.toBeNull();
    expect(screen.getByDisplayValue("gpt-4.1-mini")).not.toBeNull();
  });

  it("adds providers and model rows without replacing existing blocks", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    expect(screen.getByText("Provider 4")).not.toBeNull();
    expect(screen.getByText("OpenAI Main")).not.toBeNull();

    const addModelButtons = screen.getAllByRole("button", { name: "+ Add model" });
    fireEvent.click(addModelButtons[3]!);
    expect(screen.getAllByPlaceholderText("model-id")).toHaveLength(6);
  });

  it("keeps saved credentials redacted and submits all provider blocks", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    expect(screen.getAllByPlaceholderText("Saved key (leave blank to keep)")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    expect(saveProviderConfigs.mock.calls[0]![0]).toHaveLength(3);
    expect(saveProviderConfigs.mock.calls[0]![0][0]).not.toHaveProperty("apiKey");
  });

  it("requires an explicit action to clear a saved credential", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.click(screen.getAllByRole("button", { name: "Clear saved key" })[0]!);
    expect(screen.getByPlaceholderText("Saved key will be cleared")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    expect(saveProviderConfigs.mock.calls[0]![0][0].apiKey).toBe("");
  });

  it("includes the private-network opt-in when saving a local provider", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.change(screen.getAllByLabelText(/Base URL/)[0]!, {
      target: { value: "http://192.168.0.13:1234/v1" },
    });
    fireEvent.click(screen.getAllByLabelText("Allow private network endpoints")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    expect(saveProviderConfigs.mock.calls[0]![0][0]).toMatchObject({
      baseURL: "http://192.168.0.13:1234/v1",
      allowPrivateNetwork: true,
    });
  });

  it("assigns the synthesis primary separately from provider configuration", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.change(screen.getByLabelText("Primary"), { target: { value: "anthropic-backup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    const savedProviders = saveProviderConfigs.mock.calls[0]![0];
    expect(savedProviders[0].roles).toEqual(["available"]);
    expect(savedProviders[1].roles).toEqual(["available", "primary"]);
  });

  it("preserves synthesis selection when a custom provider ID changes", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.change(screen.getAllByLabelText("Provider ID")[0]!, { target: { value: "openai-renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    expect(saveProviderConfigs.mock.calls[0]![0][0]).toMatchObject({
      id: "openai-renamed",
      roles: ["available", "primary"],
    });
  });

  // ── Bug-fix regression tests ──────────────────────────────────────────────

  it("strips _draftId before saving", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    // Add a new provider — gets a _draftId
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));

    await vi.waitFor(() => expect(saveProviderConfigs).toHaveBeenCalledTimes(1));
    const saved = saveProviderConfigs.mock.calls[0]![0] as Record<string, unknown>[];

    // Every saved provider must be free of the internal draft marker
    for (const provider of saved) {
      expect(provider).not.toHaveProperty("_draftId");
    }
    expect(saved).toHaveLength(4);
  });

  it("retains focus in the provider ID input when typing a new ID", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));

    const idInputs = screen.getAllByLabelText("Provider ID");
    const newIdInput = idInputs[3]!;

    newIdInput.focus();
    expect(document.activeElement).toBe(newIdInput);

    // Changing the provider ID value — with the _draftId-based key the DOM
    // element stays mounted and keeps focus.
    fireEvent.change(newIdInput, { target: { value: "my-custom-provider" } });

    expect(document.activeElement).toBe(newIdInput);
    expect(screen.getByDisplayValue("my-custom-provider")).not.toBeNull();
  });

  it("preserves newly added provider across re-renders (draft survival)", async () => {
    render(<PipelinePanel />);
    await screen.findByText("OpenAI Main");

    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    expect(screen.getByText("Provider 4")).not.toBeNull();

    // Change the display name — verifies state updates correctly
    const nameInputs = screen.getAllByLabelText("Display name");
    fireEvent.change(nameInputs[3]!, { target: { value: "Draft Provider" } });
    expect(screen.getByText("Draft Provider")).not.toBeNull();

    // All original providers remain intact
    expect(screen.getByText("OpenAI Main")).not.toBeNull();
    expect(screen.getByText("Anthropic Backup")).not.toBeNull();
    expect(screen.getByText("DeepSeek Extra")).not.toBeNull();
  });

  it("shows native provider models without manual model configuration", async () => {
    render(<PipelinePanel />);

    expect(await screen.findByText("DeepSeek", { selector: "div.font-medium" })).not.toBeNull();
    expect(screen.getByText("2 models")).not.toBeNull();
  });

  it("keeps the panel rendered and reports a native catalog error", async () => {
    listProviders.mockRejectedValueOnce(new Error("provider catalog unavailable"));

    render(<PipelinePanel />);

    expect((await screen.findByRole("status")).textContent).toContain("provider catalog unavailable");
    expect(screen.getByRole("heading", { name: "Native providers", exact: true })).not.toBeNull();
  });

  it("renders explicit empty states when provider collections are absent", async () => {
    getProviderConfigs.mockResolvedValueOnce({ data: { providers: undefined, synthesis: {} } });
    listProviders.mockResolvedValueOnce({ providers: undefined });
    listIntegrations.mockResolvedValueOnce({ data: undefined });

    render(<PipelinePanel />);

    expect(await screen.findByText("No custom providers configured. Add your first custom provider.")).not.toBeNull();
    expect(await screen.findByText("No native providers are available.")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Providers", exact: true })).not.toBeNull();
  });

  it("offers OpenAI subscription OAuth methods from OpenCode", async () => {
    render(<PipelinePanel />);
    const openAi = await screen.findByText("OpenAI", { selector: "div.font-medium" });
    const card = openAi.closest("div.flex.items-center.justify-between");
    fireEvent.click(card!.querySelector("button")!);

    expect(screen.getByRole("dialog", { name: "Connect OpenAI" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "ChatGPT Pro/Plus (browser)" })).not.toBeNull();
  });

  it("cancels OAuth when the nested connection dialog closes with Escape", async () => {
    beginOAuth.mockResolvedValue({
      data: {
        attemptID: "attempt-1",
        mode: "code",
        url: "https://example.test/oauth",
      },
    });
    const outerOnClose = vi.fn();
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <Overlay isOpen onClose={outerOnClose} title="Settings">
        <PipelinePanel />
      </Overlay>,
    );

    const openAi = await screen.findByText("OpenAI", { selector: "div.font-medium" });
    fireEvent.click(openAi.closest("div.flex.items-center.justify-between")!.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Continue in browser" }));
    expect(await screen.findByLabelText("Authorization code")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    await vi.waitFor(() => expect(cancelAttempt).toHaveBeenCalledWith("attempt-1"));
    expect(outerOnClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Connect OpenAI" })).toBeNull();
    windowOpen.mockRestore();
  });

  it("does not leave a new connection dialog disabled after cancelling an in-flight key connection", async () => {
    let resolveConnect!: () => void;
    connectKey.mockReturnValue(new Promise<void>((resolve) => { resolveConnect = resolve; }));
    render(<PipelinePanel />);

    const deepSeek = await screen.findByText("DeepSeek", { selector: "div.font-medium" });
    fireEvent.click(deepSeek.closest("div.flex.items-center.justify-between")!.querySelector("button")!);
    let dialog = screen.getByRole("dialog", { name: "Connect DeepSeek" });
    fireEvent.change(within(dialog).getByLabelText("API key"), { target: { value: "key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(deepSeek.closest("div.flex.items-center.justify-between")!.querySelector("button")!);
    dialog = screen.getByRole("dialog", { name: "Connect DeepSeek" });
    fireEvent.change(within(dialog).getByLabelText("API key"), { target: { value: "new-key" } });

    expect((within(dialog).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
    resolveConnect();
  });
});
