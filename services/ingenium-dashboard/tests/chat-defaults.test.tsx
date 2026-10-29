import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), save: vi.fn() }));
vi.mock("../src/lib/opencode", () => ({ createOpenCodeClient: () => ({ chat: { config: mocks.config, saveDefaults: mocks.save } }) }));
import ChatDefaults from "../src/app/components/settings/panels/ChatDefaults";
const selection = { providerId: "openai", modelId: "gpt-6-luna", variant: "high" };
const config = { providers: [{ providerId: "openai", label: "ChatGPT", defaultModel: "gpt-6-luna",
  models: [{ id: "gpt-6-luna", label: "GPT-6 Luna", variants: { none: {}, high: {}, max: {} } }, { id: "plain-model", label: "Plain" }] }],
  defaultSelection: selection };
beforeEach(() => { mocks.config.mockResolvedValue(config); mocks.save.mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Settings Chat defaults", () => {
  it("loads the persisted provider/model/effort and saves only the complete explicit draft", async () => {
    render(<ChatDefaults />);
    await waitFor(() => expect(screen.getByLabelText("Reasoning effort")).toHaveValue("high"));
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-6-luna");
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "max" } });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Chat defaults" }));
    await screen.findByText("Chat defaults saved.");
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...selection, variant: "max" });
    cleanup();
    mocks.config.mockResolvedValue({ ...config, defaultSelection: { ...selection, variant: "max" } });
    render(<ChatDefaults />);
    await waitFor(() => expect(screen.getByLabelText("Reasoning effort")).toHaveValue("max"));
  });
  it("clears unsupported effort on a model change and does not offer invented efforts", async () => {
    render(<ChatDefaults />);
    await screen.findByDisplayValue("GPT-6 Luna");
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "plain-model" } });
    expect(screen.getByLabelText("Reasoning effort")).toBeDisabled();
    expect(screen.getByLabelText("Reasoning effort")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "high" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Chat defaults" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ providerId: "openai", modelId: "plain-model" }));
  });
  it("keeps a failed save visible and never reports success", async () => {
    mocks.save.mockRejectedValue(new Error("upstream private detail"));
    render(<ChatDefaults />);
    await screen.findByDisplayValue("GPT-6 Luna");
    fireEvent.click(screen.getByRole("button", { name: "Save Chat defaults" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reload to check before retrying");
    expect(screen.queryByText("Chat defaults saved.")).toBeNull();
    expect(screen.queryByText("upstream private detail")).toBeNull();
  });
  it("allows retry after a catalog failure without enabling writes", async () => {
    mocks.config.mockRejectedValueOnce(new Error("offline"));
    render(<ChatDefaults />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Save Chat defaults" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry Chat defaults" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-6-luna"));
  });
});
