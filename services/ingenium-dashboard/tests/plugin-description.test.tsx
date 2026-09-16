import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { api, type Plugin } from "../src/lib/api";
import PluginsPage from "../src/app/plugins/page";

const selection = vi.hoisted(() => ({ project: "ingenium" }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => selection.project }));
vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
}));
let stored: Plugin;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  selection.project = "ingenium";
  stored = { id: "plugin", name: "fixture/plugin", description: "Original purpose", file_path: "external.ts", enabled: true, source_content: "export {};" };
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "PUT") stored = { ...stored, ...JSON.parse(options.body as string) };
    return new Response(JSON.stringify({ data: url.includes("/plugins?") ? [stored] : stored }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("saves only description through the real API helper, reloads it and renders untrusted text safely", async () => {
  const view = render(<PluginsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View plugin fixture/plugin" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
  const value = "<img src=x onerror=alert(1)> Local purpose";
  expect(screen.getByLabelText("Description").getAttribute("maxlength")).toBe("2000");
  fireEvent.change(screen.getByLabelText("Description"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save description" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Description saved and reloaded.");
  expect(within(screen.getByRole("dialog")).getByText(value)).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
  const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toContain("/plugins/fixture%2Fplugin?project=ingenium");
  expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ description: value });
  expect(stored).toMatchObject({ file_path: "external.ts", enabled: true, source_content: "export {};" });
  view.unmount();
  render(<PluginsPage />);
  expect(await screen.findByText(value)).toBeInTheDocument();
});

it("keeps drafts on failure, disables duplicate saves and permits cancellation", async () => {
  let rejectSave!: (error: Error) => void;
  vi.spyOn(api.plugins, "updateDescription").mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  render(<PluginsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View plugin fixture/plugin" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save description" }));
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  rejectSave(new Error("Save unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
  expect(screen.getByLabelText("Description")).toHaveValue("Draft");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByLabelText("Description")).toBeNull());
  expect(stored.description).toBe("Original purpose");
});

it("discards the previous project editor and ignores its late save result after switching projects", async () => {
  let finishSave!: (result: { data: Plugin }) => void;
  vi.spyOn(api.plugins, "updateDescription").mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
  const reload = vi.spyOn(api.plugins, "get");
  const view = render(<PluginsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View plugin fixture/plugin" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Previous project notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save description" }));
  selection.project = "another-project";
  view.rerender(<PluginsPage />);
  expect(await screen.findByText("Original purpose")).toBeInTheDocument();
  finishSave({ data: stored });
  await waitFor(() => expect(reload).toHaveBeenCalledWith("fixture/plugin", "ingenium"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Previous project notes")).toBeNull();
  expect(api.plugins.updateDescription).toHaveBeenCalledWith("fixture/plugin", "Previous project notes", "ingenium");
});
