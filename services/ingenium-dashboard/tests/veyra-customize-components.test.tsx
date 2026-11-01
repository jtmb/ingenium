import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { CustomizeEntry } from "../src/app/components/customize-v2/catalog.mjs";

const { listPlugins, listSkills, listProjects, request } = vi.hoisted(() => ({
  listPlugins: vi.fn(), listSkills: vi.fn(), listProjects: vi.fn(), request: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ request, api: {
  plugins: { list: listPlugins }, skills: { list: listSkills }, projects: { list: listProjects },
} }));
vi.mock("../src/lib/AuthContext",()=>({useAuth:()=>({user:{id:"fixture-actor"}})}));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "active-project" }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

import CustomizeSurface, { CustomizeCatalogView, type CustomizeCatalogSource } from "../src/app/components/customize-v2/CustomizeSurface";

beforeEach(() => {
  listPlugins.mockReset().mockResolvedValue({ data: [] });
  listSkills.mockReset().mockResolvedValue({ data: [] });
  listProjects.mockReset().mockResolvedValue({ data: [] });
  request.mockReset().mockImplementation(async (path: string) => {
    const params = new URL("https://fixture.invalid" + path).searchParams;
    return {scope: {kind: "project", projectId: params.get("project") === "active-project" ? "current" : "installation"}, scopes: [params.get("visibility")], data: [], pagination: {offset: 0, limit: 100, total: 0, hasMore: false}};
  });
});
afterEach(cleanup);

function entry(id: string, name: string): CustomizeEntry {
  return { id, name, description: "Scoped fixture", kind: "skill", scope: "Personal", category: "Local",
    installed: true, enabled: true, archived: false };
}

describe("Customize scope ownership and presentation", () => {
  it("does not retain a real project named projectless when the logical project becomes null", async () => {
    listPlugins.mockResolvedValue({ data: [{ id: "old", name: "Previous project private plugin", description: "", enabled: true }] });
    const view = render(<CustomizeCatalogView project="projectless" kind="plugin" />);
    await screen.findByRole("button", { name: "Previous project private plugin, Installed", exact: true });
    view.rerender(<CustomizeCatalogView project={null} kind="plugin" />);
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Previous project private plugin", { exact: true })).toBeNull();
    expect(listPlugins).toHaveBeenCalledTimes(1);
    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "Add", exact: true })).toBeNull();
  });

  it("discards a stale Personal source result after actor ownership changes", async () => {
    let completeA: (entries: CustomizeEntry[]) => void = () => { throw new Error("Reader was not initialized."); };
    const sourceA: CustomizeCatalogSource = {
      id: "personal", scopeIdentity: "actor-a", label: "Personal",
      read: vi.fn(() => new Promise<CustomizeEntry[]>((resolve) => { completeA = resolve; })),
    };
    const sourceB: CustomizeCatalogSource = {
      id: "personal", scopeIdentity: "actor-b", label: "Personal",
      read: vi.fn(async () => [entry("new", "Actor B skill")]),
    };
    const view = render(<CustomizeCatalogView project={null} kind="skill" catalogSources={[sourceA]} />);
    await waitFor(() => expect(sourceA.read).toHaveBeenCalledTimes(1));
    view.rerender(<CustomizeCatalogView project={null} kind="skill" catalogSources={[sourceB]} />);
    await screen.findByRole("button", { name: "Actor B skill, Installed", exact: true });
    await act(async () => { completeA([entry("old", "Actor A private skill")]); });
    expect(screen.queryByText("Actor A private skill")).toBeNull();
    expect(listPlugins).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
  });

  it("reads System from the exact installation namespace and preserves editor/archival scope", async () => {
    listProjects.mockResolvedValue({ data: [{ id: "installation", name: "explicit-installation", is_global: true }] });
    listSkills.mockImplementation(async (project: string) => ({ data: project === "explicit-installation"
      ? [{ id: "planning", project_id: "installation", name: "phased-checkout-orchestration", description: "Fixture", enabled: 1 }]
      : [] }));
    render(<CustomizeCatalogView project="active-project" kind="skill" />);
    fireEvent.click(screen.getByRole("button", { name: "System", exact: true }));
    const row = await screen.findByRole("button", { name: "phased-checkout-orchestration, Installed", exact: true });
    fireEvent.click(row);
    expect(screen.getByRole("link", { name: "Open editor & lifecycle controls", exact: true }))
      .toHaveAttribute("href", "/customize/skills/manage?project=explicit-installation");
    expect(screen.getByRole("link", { name: "Archive & restore skills", exact: true }))
      .toHaveAttribute("href", "/customize/skills/archive?project=explicit-installation");
    expect(listSkills).toHaveBeenCalledWith("explicit-installation");
    expect(listSkills).not.toHaveBeenCalledWith("global-default");
  });

  it("distinguishes discoverable from installed records and does not open an unrelated editor", async () => {
    const source: CustomizeCatalogSource = {
      id: "public", scopeIdentity: "approved-catalog", label: "Public",
      read: async () => [{ ...entry("available", "Available task skill"), installed: false, enabled: false, scope: "Public" }],
    };
    render(<CustomizeCatalogView project={null} kind="skill" catalogSources={[source]} />);
    fireEvent.click(screen.getByRole("button", { name: "Public", exact: true }));
    const row = await screen.findByRole("button", { name: "Available task skill, Available", exact: true });
    fireEvent.click(row);
    expect(screen.queryByRole("link", { name: "Open editor & lifecycle controls", exact: true })).toBeNull();
    expect(listSkills).not.toHaveBeenCalled();
  });

  it("surfaces scope denial without retrying or falling back to project storage", async () => {
    const source: CustomizeCatalogSource = {
      id: "personal", scopeIdentity: "actor-denied", label: "Personal",
      read: vi.fn(async () => { throw new Error("Read denied"); }),
    };
    render(<CustomizeCatalogView project={null} kind="skill" catalogSources={[source]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("scoped catalog could not be loaded");
    expect(source.read).toHaveBeenCalledTimes(1);
    expect(listSkills).not.toHaveBeenCalled();
    expect(listPlugins).not.toHaveBeenCalled();
  });
  it("contains synchronous source failures in the catalog pane", async () => {
    const source: CustomizeCatalogSource = {
      id: "personal", scopeIdentity: "actor-sync-denied", label: "Personal",
      read: vi.fn(() => { throw new Error("Synchronous capability denial"); }),
    };
    render(<CustomizeCatalogView project={null} kind="skill" catalogSources={[source]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("scoped catalog could not be loaded");
    expect(screen.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
    expect(source.read).toHaveBeenCalledTimes(1);
  });
  it("uses host navigation for a projectless view without inventing a global-project link", async () => {
    const navigate = vi.fn();
    render(<CustomizeCatalogView project={null} kind="skill" onNavigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "⊞ Plugins", exact: true }));
    expect(navigate).toHaveBeenCalledWith("plugin");
    expect(screen.queryByRole("link", { name: "⊞ Plugins", exact: true })).toBeNull();
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    expect(listPlugins).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
  });
  it("uses a full project catalog's disabled state without falling back to active-only APIs", async () => {
    const source: CustomizeCatalogSource = {
      id: "project", scopeIdentity: "full-project-catalog", label: "active-project", apiProject: "active-project",
      read: vi.fn(async (kind) => kind === "skill" ? [{
        ...entry("disabled", "Disabled task skill"), scope: "active-project", apiProject: "active-project", enabled: false,
      }] : []),
    };
    render(<CustomizeCatalogView project="active-project" kind="skill" catalogSources={[source]} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Disabled task skill, Installed · disabled", exact: true })).toHaveLength(2));
    expect(listSkills).not.toHaveBeenCalled();
    expect(listPlugins).not.toHaveBeenCalled();
  });

  it("does not substitute the legacy active-only list when a full project catalog is denied", async () => {
    const source: CustomizeCatalogSource = {
      id: "project", scopeIdentity: "denied-project-catalog", label: "active-project", apiProject: "active-project",
      read: vi.fn(async () => { throw new Error("Full catalog access denied"); }),
    };
    render(<CustomizeCatalogView project="active-project" kind="skill" catalogSources={[source]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Skills could not be loaded");
    expect(listSkills).not.toHaveBeenCalled();
    expect(listPlugins).not.toHaveBeenCalled();
  });
});

describe("default hosted catalog bindings", () => {
  it("waits for the authenticated index then uses full current and System readers only", async () => {
    listProjects.mockResolvedValue({data: [
      {id: "current", name: "active-project"}, {id: "installation", name: "actual-owner", is_global: true},
    ]});
    render(<CustomizeSurface kind="skill" />);
    await screen.findByRole("heading", {name: "Skills", exact: true});
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", {name: "System", exact: true}));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    const params = new URL("https://fixture.invalid" + request.mock.calls[2][0]).searchParams;
    expect(params.get("project")).toBe("actual-owner");
    expect(params.get("visibility")).toBe("system");
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(listSkills).not.toHaveBeenCalled();
    expect(listPlugins).not.toHaveBeenCalled();
  });

  it("does not read or fall back when the selected project is unavailable", async () => {
    render(<CustomizeSurface kind="skill" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog scope could not be resolved");
    expect(request).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
    expect(listPlugins).not.toHaveBeenCalled();
  });

  it("fails closed on both project and Personal read denial without substituting storage", async () => {
    listProjects.mockResolvedValue({data: [{id: "current", name: "active-project"}]});
    request.mockRejectedValue(new Error("Catalog denied"));
    render(<CustomizeSurface kind="skill" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Skills could not be loaded");
    fireEvent.click(screen.getByRole("button", {name: "Personal", exact: true}));
    await screen.findByText("This scoped catalog could not be loaded. Check access and refresh; no other scope was substituted.");
    expect(request).toHaveBeenCalledTimes(3);
    const params=new URL("https://fixture.invalid"+request.mock.calls[2][0]).searchParams;expect(params.get("projectId")).toBe("current");expect(params.get("visibility")).toBe("personal");
    expect(listSkills).not.toHaveBeenCalled();
  });
});

it("loads the hosted Public catalog through the session-owned projection instead of the legacy unavailable pane",async()=>{
 listProjects.mockResolvedValue({data:[{id:"current",name:"active-project"}]});
 const legacy=request.getMockImplementation()!;
 request.mockImplementation(async(path:string)=>{
  if(path.startsWith("/customize/catalog?"))return {data:{projectId:"current",kind:"plugin",visibility:"public",data:[],next:null}};
  return legacy(path);
 });
 render(<CustomizeSurface kind="plugin"/>);await screen.findByRole("heading",{name:"Plugins",exact:true});
 fireEvent.click(screen.getByRole("button",{name:"Public",exact:true}));await screen.findByText("No resources in this scope.");
 expect(screen.queryByText(/Public catalog is unavailable/)).toBeNull();
 const calls=request.mock.calls.filter(([path])=>path.startsWith("/customize/catalog?"));expect(calls).toHaveLength(1);
 const params=new URL("https://fixture.invalid"+calls[0][0]).searchParams;expect(params.get("projectId")).toBe("current");expect(params.get("visibility")).toBe("public");expect(params.has("ownerUserId")).toBe(false);expect(params.has("project")).toBe(false);
 expect(listPlugins).not.toHaveBeenCalled();expect(listSkills).not.toHaveBeenCalled();
});
