import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  invitations: vi.fn(),
  projectMembers: vi.fn(),
}));

vi.mock("../src/lib/OrganizationContext", () => ({
  useOrganization: () => ({
    organizations: [{ id: "org-one", name: "Bootstrap Organization", slug: "bootstrap", status: "active", role: "owner" }],
  }),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "global-default",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    organizations: {
      members: mocks.members,
      invitations: mocks.invitations,
      projectMembers: mocks.projectMembers,
      setMemberRole: vi.fn(),
      removeMember: vi.fn(),
      invite: vi.fn(),
      revokeInvitation: vi.fn(),
      setProjectMember: vi.fn(),
      removeProjectMember: vi.fn(),
    },
    auth: { stepUp: vi.fn() },
  },
}));

import OrganizationsPage from "../src/app/organizations/page";

const capabilities = {
  effectiveRole: "owner",
  canManageMembers: true,
  canManageInvitations: true,
  canManageProjectMembers: true,
};

beforeEach(() => {
  mocks.members.mockResolvedValue({
    data: [{ userId: "user-one", email: "bootstrap-admin@localhost", displayName: "Bootstrap Administrator", role: "owner", status: "active" }],
    capabilities,
  });
  mocks.invitations.mockResolvedValue({ data: [] });
  mocks.projectMembers.mockResolvedValue({ data: [], capabilities });
});

afterEach(cleanup);

describe("Organizations route responsive structure", () => {
  it("keeps the page and project access controls shrinkable at mobile width", async () => {
    render(<OrganizationsPage />);

    const page = await screen.findByTestId("organizations-page");
    expect(page.className).toContain("w-full");
    expect(page.className).toContain("min-w-0");
    expect((await screen.findByRole("button", { name: "Invite" })).className).toContain("py-2");

    const memberPicker = await screen.findByLabelText("Organization member");
    expect(memberPicker.className).toContain("w-full");
    expect(memberPicker.parentElement?.className).toContain("min-w-0");
    expect(memberPicker.closest("form")?.className).toContain("min-w-0");
    expect(screen.getByLabelText("Invitation role")).toBeTruthy();
  });
});
