import { Router } from "express";
import { authentication, invitations, organizations, projects } from "ingenium-core";
import { z } from "zod";
import { AppError } from "../middleware/errors.js";

const organizationRole = z.enum(["owner", "admin", "member", "viewer"]);
const invitationRole = z.enum(["admin", "member", "viewer"]);
const projectRole = z.enum(["editor", "viewer"]);

function requireRecentStepUp(req: import("express").Request): void {
  if (req.principal?.type !== "user" || !req.principal.session
    || !authentication.hasRecentStepUp(req.principal.session)) {
    throw new AppError("Recent step-up authentication is required", "STEP_UP_REQUIRED", 403);
  }
}

function requireOwnerForOwnerChange(req: import("express").Request, nextRole?: string): void {
  if (req.principal?.type === "compatibility") return;
  if (req.principal?.type !== "user") throw new AppError("Organization owner permission is required", "FORBIDDEN", 403);
  const targetRole = organizations.getOrganizationRole(req.params.organizationId!, req.params.userId!);
  if ((targetRole === "owner" || nextRole === "owner")
    && organizations.getOrganizationRole(req.params.organizationId!, req.principal.id) !== "owner") {
    throw new AppError("Organization owner permission is required", "FORBIDDEN", 403);
  }
}

function organizationCapabilities(req: import("express").Request, organizationId: string) {
  const role = req.principal?.type === "user"
    ? organizations.getOrganizationRole(organizationId, req.principal.id)
    : undefined;
  return {
    effectiveRole: role ?? null,
    canManageMembers: role === "owner" || role === "admin",
    canManageInvitations: role === "owner" || role === "admin",
    canManageProjectMembers: role === "owner" || role === "admin",
  };
}

export const organizationsRouter = Router();

organizationsRouter.get("/", (req, res) => {
  if (req.principal?.type === "compatibility") return res.json({ data: [organizations.getOrganization(organizations.BOOTSTRAP_ORGANIZATION_ID)] });
  if (req.principal?.type !== "user") throw new AppError("User organization membership is required", "FORBIDDEN", 403);
  return res.json({ data: organizations.listUserOrganizations(req.principal.id).map((organization) => ({
    ...organization,
    role: organizations.getOrganizationRole(organization.id, req.principal!.id),
  })) });
});

organizationsRouter.post("/", (req, res) => {
  requireRecentStepUp(req);
  const input = z.object({ name: z.string().min(1).max(128), slug: z.string().regex(/^[a-z0-9-]{1,64}$/) }).strict().parse(req.body);
  const id = organizations.createOrganization(input.name, input.slug);
  organizations.addOrganizationMember(id, req.principal!.id, "owner");
  res.status(201).location(`/api/v1/organizations/${id}`).json({ data: organizations.getOrganization(id) });
});

organizationsRouter.get("/:organizationId", (req, res) => {
  const organization = organizations.getOrganization(req.params.organizationId!);
  if (!organization) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.json({ data: organization });
});

organizationsRouter.get("/:organizationId/members", (req, res) => {
  res.json({ data: organizations.listOrganizationMembers(req.params.organizationId!), capabilities: organizationCapabilities(req, req.params.organizationId!) });
});

organizationsRouter.patch("/:organizationId/members/:userId", (req, res) => {
  requireRecentStepUp(req);
  const { role } = z.object({ role: organizationRole }).strict().parse(req.body);
  requireOwnerForOwnerChange(req, role);
  if (!organizations.setOrganizationMemberRole(req.params.organizationId!, req.params.userId!, role)) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.status(204).end();
});

organizationsRouter.delete("/:organizationId/members/:userId", (req, res) => {
  requireRecentStepUp(req);
  requireOwnerForOwnerChange(req);
  if (!organizations.removeOrganizationMember(req.params.organizationId!, req.params.userId!)) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.status(204).end();
});

organizationsRouter.get("/:organizationId/invitations", (req, res) => {
  res.json({ data: invitations.listInvitations(req.params.organizationId!) });
});

organizationsRouter.post("/:organizationId/invitations", (req, res) => {
  requireRecentStepUp(req);
  const input = z.object({ email: z.string().min(3).max(320), role: invitationRole }).strict().parse(req.body);
  invitations.issueInvitation(req.params.organizationId!, input.email, input.role);
  res.status(201).json({ data: { invited: true } });
});

organizationsRouter.delete("/:organizationId/invitations/:invitationId", (req, res) => {
  requireRecentStepUp(req);
  if (!invitations.revokeInvitation(req.params.organizationId!, req.params.invitationId!)) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.status(204).end();
});

organizationsRouter.get("/:organizationId/projects/:projectName/members", (req, res) => {
  const project = projects.getProject(req.params.projectName!);
  if (!project || project.organization_id !== req.params.organizationId) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.json({ data: organizations.listProjectMembers(project.id), capabilities: organizationCapabilities(req, req.params.organizationId!) });
});

organizationsRouter.put("/:organizationId/projects/:projectName/members/:userId", (req, res) => {
  requireRecentStepUp(req);
  const project = projects.getProject(req.params.projectName!);
  if (!project || project.organization_id !== req.params.organizationId) throw new AppError("Resource not found", "NOT_FOUND", 404);
  const { role } = z.object({ role: projectRole }).strict().parse(req.body);
  organizations.addProjectMember(project.id, req.params.userId!, role);
  res.status(204).end();
});

organizationsRouter.delete("/:organizationId/projects/:projectName/members/:userId", (req, res) => {
  requireRecentStepUp(req);
  const project = projects.getProject(req.params.projectName!);
  if (!project || project.organization_id !== req.params.organizationId) throw new AppError("Resource not found", "NOT_FOUND", 404);
  if (!organizations.removeProjectMember(project.id, req.params.userId!)) throw new AppError("Resource not found", "NOT_FOUND", 404);
  res.status(204).end();
});
