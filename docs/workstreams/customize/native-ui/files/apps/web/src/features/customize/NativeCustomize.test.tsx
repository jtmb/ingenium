import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { Project } from "@veyra/contracts";
import type { Gateway } from "../../platform/types";
import { NativeCustomize } from "./NativeCustomize";

vi.mock("../extensions/PluginPackages", () => ({PluginPackages: () => <p>Existing package registration owner</p>}));
vi.mock("../extensions/SkillWorkspace", () => ({SkillWorkspace: () => {
  const [draft, setDraft] = useState("");
  return <label>Existing skill draft<input value={draft} onChange={event => setDraft(event.target.value)}/></label>;
}}));
vi.mock("../extensions/ExtensionsPanel", () => ({ExtensionsPanel: () => <p>Existing MCP and permission owner</p>}));
vi.mock("../extensions/InstructionEditor", () => ({InstructionEditor: () => <p>Existing instruction owner</p>}));
vi.mock("../extensions/ScopedEngineSettings", () => ({ScopedEngineSettings: () => <p>Existing settings owner</p>}));
const project: Project = {id: "project", name: "Local project", revision: 4, environment: {kind: "windows"}, primary_root: "C:/fixture", roots: ["C:/fixture"], archived: false, pinned: false};
const request = vi.fn();
const gateway = {workbench: request} as unknown as Gateway;
function reply(path: string, id = project.id) {
  const shared = {service_instance_id: "service", project_id: id, project_revision: 4};
  return path.includes("skill-workspace")
    ? {...shared, revision: "a", supported: true, reason: null, skills: [{id: "release", name: "Release", description: "Source", path: ".agents/skills/release/SKILL.md", content: "# Source", editable: true, reason: null}]}
    : {...shared, revision: 1, restart_required: true, engine_stopped: true, packages: [{id: "tools", selected_sha256: "a", versions: [{sha256: "a", manifest: {id: "tools", version: "1", license: "MIT"}}], enabled: false, removed: false, activation: "Restart and observe actual inventory"}]};
}
const legacy = () => <p>Existing agents hooks and notes</p>;
beforeEach(() => { request.mockReset().mockImplementation(async (_method: string, path: string) => reply(path)); });
afterEach(cleanup);
describe("native Customize owner integration", () => {
  it("shows real registered-disabled state and leaves unsupported scopes unavailable without extra reads", async () => {
    render(<NativeCustomize gateway={gateway} project={project} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}/>);
    await screen.findByRole("button", {name: "tools, Registered · disabled", exact: true});
    fireEvent.click(screen.getByRole("button", {name: "Personal", exact: true}));
    expect(screen.getByText(/Personal catalog is unavailable/)).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("keeps the exact existing skill draft owner mounted while navigating catalog pages", async () => {
    render(<NativeCustomize gateway={gateway} project={project} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}/>);
    await screen.findByRole("button", {name: "tools, Registered · disabled", exact: true});
    fireEvent.click(screen.getByRole("button", {name: "Skills", exact: true}));
    fireEvent.click(screen.getByRole("button", {name: "Add", exact: true}));
    fireEvent.change(await screen.findByRole("textbox", {name: "Existing skill draft"}), {target: {value: "Exact unsaved draft"}});
    fireEvent.click(screen.getByRole("button", {name: "Back to catalog"}));
    fireEvent.click(await screen.findByRole("button", {name: "Open source editor"}));
    expect((screen.getByRole("textbox", {name: "Existing skill draft"}) as HTMLInputElement).value).toBe("Exact unsaved draft");
  });
  it("does not infer a project or dispatch a native catalog read from a projectless view", () => {
    render(<NativeCustomize gateway={gateway} project={null} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}/>);
    expect(screen.getAllByText(/No global project is selected/).length).toBeGreaterThan(0);
    expect(request).not.toHaveBeenCalled();
  });
  it("discards late source rows from a previous project", async () => {
    let complete!: (value: unknown) => void;
    request.mockImplementation((_method: string, path: string) => path.includes("project_id=project&")
      ? new Promise(resolve => {if (path.includes("plugin-packages")) complete = resolve;})
      : Promise.resolve(reply(path, "other")));
    const view = render(<NativeCustomize gateway={gateway} project={project} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}/>);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    view.rerender(<NativeCustomize gateway={gateway} project={{...project, id: "other"}} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}/>);
    await screen.findByRole("button", {name: "tools, Registered · disabled", exact: true});
    await act(async () => {complete({...reply("/v1/plugin-packages/"), packages: []});});
    expect(screen.getByRole("button", {name: "tools, Registered · disabled", exact: true})).toBeTruthy();
  });
  it("does not treat a mismatched governance slot as authenticated hosted lifecycle", async () => {
    render(<NativeCustomize gateway={gateway} project={project} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}
      hostedGovernance={{serviceInstanceId: "foreign", projectId: "project", projectRevision: 4, actorId: "actor", installationId: "installation", hostedProjectId: "hosted-project", content: <p>Wrong owner secret</p>}}/>);
    fireEvent.click(screen.getByRole("button", {name: "Hosted skill governance", exact: true}));
    expect(screen.getByText("Hosted skill governance is unavailable")).toBeTruthy();
    expect(screen.queryByText("Wrong owner secret")).toBeNull();
  });
});

it("admits an explicitly projectless hosted owner without synthesizing native project reads", () => {
  render(<NativeCustomize gateway={gateway} project={null} connected serviceInstanceId="service" renderLegacyWorkflows={legacy}
    hostedGovernance={{serviceInstanceId: "service", projectId: null, projectRevision: null, actorId: "actor",
      installationId: "installation", hostedProjectId: null, content: <p>Authenticated private governance fixture</p>}}/>);
  fireEvent.click(screen.getByRole("button", {name: "Hosted skill governance", exact: true}));
  expect(screen.getByText("Authenticated private governance fixture")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
