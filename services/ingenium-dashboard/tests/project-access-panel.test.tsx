import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ members: vi.fn(), projectMembers: vi.fn(), setProjectMember: vi.fn(), removeProjectMember: vi.fn() }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "project-one" }));
vi.mock("../src/lib/api", () => ({ api: { organizations: mocks } }));
vi.mock("../src/app/components/auth/StepUpDialog", () => ({ default: ({ open, onComplete }: { open: boolean; onComplete: () => void }) => open ? <button onClick={onComplete}>Confirm step-up</button> : null }));
import ProjectAccessPanel from "../src/app/organizations/ProjectAccessPanel";
const organization = { id: "org-one", name: "Org", slug: "org", status: "active", role: "admin" } as const;
const capabilities = { effectiveRole: "admin", canManageMembers: true, canManageInvitations: true, canManageProjectMembers: true } as const;

describe("project access panel", () => {
  beforeEach(() => { mocks.members.mockResolvedValue({ data: [{ userId: "user-two", email: "two@example.test", displayName: "Two", role: "member", status: "active" }], capabilities }); mocks.projectMembers.mockResolvedValue({ data: [], capabilities }); mocks.setProjectMember.mockResolvedValue(undefined); mocks.removeProjectMember.mockResolvedValue(undefined); });
  afterEach(cleanup);
  it("lists, adds, changes, and removes project memberships", async () => {
    render(<ProjectAccessPanel organization={organization} />);
    await screen.findByText("No explicit project memberships.");
    fireEvent.change(screen.getByLabelText("Organization member"), { target: { value: "user-two" } }); fireEvent.click(screen.getByRole("button", { name: "Add access" })); fireEvent.click(screen.getByRole("button", { name: "Confirm step-up" }));
    await waitFor(() => expect(mocks.setProjectMember).toHaveBeenCalledWith("org-one", "project-one", "user-two", "viewer"));
    cleanup(); mocks.projectMembers.mockResolvedValue({ data: [{ userId: "user-two", email: "two@example.test", displayName: "Two", role: "viewer" }], capabilities });
    render(<ProjectAccessPanel organization={organization} />); await screen.findByText("two@example.test");
    fireEvent.change(screen.getByLabelText("Project role for two@example.test"), { target: { value: "editor" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm step-up" })); await waitFor(() => expect(mocks.setProjectMember).toHaveBeenCalledWith("org-one", "project-one", "user-two", "editor"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" })); fireEvent.click(screen.getByRole("button", { name: "Confirm step-up" })); await waitFor(() => expect(mocks.removeProjectMember).toHaveBeenCalledWith("org-one", "project-one", "user-two"));
  });
  it("renders denied capability without mutation controls", async () => { mocks.projectMembers.mockResolvedValue({ data: [{ userId: "user-two", email: "two@example.test", displayName: "Two", role: "viewer" }], capabilities: { ...capabilities, effectiveRole: "member", canManageProjectMembers: false } }); render(<ProjectAccessPanel organization={{ ...organization, role: "member" }} />); await screen.findByText("You can view project access but cannot change it."); expect(screen.queryByRole("button", { name: "Remove" })).toBeNull(); });
});
