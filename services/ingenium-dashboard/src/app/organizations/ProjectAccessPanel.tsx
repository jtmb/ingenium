"use client";

import { useEffect, useState } from "react";
import { api, type OrganizationCapabilities, type OrganizationMember, type OrganizationSummary, type ProjectMember } from "@/lib/api";
import { useProject } from "@/lib/ProjectContext";
import Select from "@/app/components/Select";
import StepUpDialog from "@/app/components/auth/StepUpDialog";

const emptyCapabilities: OrganizationCapabilities = { effectiveRole: null, canManageMembers: false, canManageInvitations: false, canManageProjectMembers: false };

export default function ProjectAccessPanel({ organization }: { organization: OrganizationSummary }) {
  const project = useProject();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedUser, setSelectedUser] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [stepUpAction, setStepUpAction] = useState<(() => void) | null>(null);

  const load = () => {
    setStatus("loading");
    void Promise.all([api.organizations.members(organization.id), api.organizations.projectMembers(organization.id, project)])
      .then(([organizationMembers, access]) => {
        setMembers(organizationMembers.data);
        setProjectMembers(access.data);
        setCapabilities(access.capabilities);
        setStatus("ready");
      }, () => setStatus("error"));
  };
  useEffect(load, [organization.id, project]);

  const mutate = (action: () => Promise<void>) => setStepUpAction(() => () => void action().then(load));
  const assigned = new Set(projectMembers.map((member) => member.userId));
  const candidates = members.filter((member) => !assigned.has(member.userId));

  return <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 hover:shadow-md transition-shadow" aria-labelledby="project-access-title">
    <h2 id="project-access-title" className="break-words text-lg font-semibold">Project access: {project}</h2>
    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Effective organization role: {capabilities.effectiveRole ?? "unavailable"}. Owners and admins already have access; explicit memberships grant member and viewer access.</p>
    {status === "loading" && <p className="mt-4 text-sm text-[var(--color-text-muted)]" aria-busy="true">Loading project access…</p>}
    {status === "error" && <div className="mt-4" role="alert"><p className="text-sm text-[var(--color-error-text)]">Project access could not be loaded.</p><button className="mt-2 rounded border border-[var(--color-border)] px-3 py-2" onClick={load}>Retry</button></div>}
    {status === "ready" && <>
      {capabilities.canManageProjectMembers && candidates.length > 0 && <form className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); if (selectedUser) mutate(() => api.organizations.setProjectMember(organization.id, project, selectedUser, role)); }}>
        <Select aria-label="Organization member" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} wrapperClassName="w-full min-w-0" className="w-full sm:w-auto"><option value="">Select member</option>{candidates.map((member) => <option key={member.userId} value={member.userId}>{member.displayName} ({member.email})</option>)}</Select>
        <Select aria-label="Project role" value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")}><option value="editor">editor</option><option value="viewer">viewer</option></Select>
        <button disabled={!selectedUser} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Add access</button>
      </form>}
      {projectMembers.length === 0 ? <p className="mt-4 text-sm text-[var(--color-text-muted)]">No explicit project memberships.</p> : <ul className="mt-4 divide-y divide-[var(--color-border)]">{projectMembers.map((member) => <li key={member.userId} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-medium">{member.displayName}</p><p className="break-all text-sm text-[var(--color-text-muted)]">{member.email}</p></div>{capabilities.canManageProjectMembers ? <div className="flex min-w-0 flex-wrap items-center gap-2"><Select aria-label={`Project role for ${member.email}`} value={member.role} onChange={(event) => { const nextRole = event.target.value; mutate(() => api.organizations.setProjectMember(organization.id, project, member.userId, nextRole)); }}><option value="editor">editor</option><option value="viewer">viewer</option></Select><button className="rounded border border-[var(--color-border)] px-3 py-2 text-sm" onClick={() => mutate(() => api.organizations.removeProjectMember(organization.id, project, member.userId))}>Remove</button></div> : <span className="text-sm text-[var(--color-text-secondary)]">{member.role}</span>}</li>)}</ul>}
      {!capabilities.canManageProjectMembers && <p className="mt-4 text-sm text-[var(--color-text-muted)]">You can view project access but cannot change it.</p>}
    </>}
    <StepUpDialog open={stepUpAction !== null} onClose={() => setStepUpAction(null)} onComplete={() => { const action = stepUpAction; setStepUpAction(null); action?.(); }} />
  </section>;
}
