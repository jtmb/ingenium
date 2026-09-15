"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/lib/OrganizationContext";
import { api, type OrganizationCapabilities, type OrganizationMember } from "@/lib/api";
import Select from "@/app/components/Select";
import { authInput } from "@/app/components/auth/AuthCard";
import StepUpDialog from "@/app/components/auth/StepUpDialog";
import ProjectAccessPanel from "./ProjectAccessPanel";

type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
const noCapabilities: OrganizationCapabilities = { effectiveRole: null, canManageMembers: false, canManageInvitations: false, canManageProjectMembers: false };

export default function OrganizationsPage() {
  const { organizations } = useOrganization();
  const [selected, setSelected] = useState("");
  const organization = organizations.find((item) => item.id === selected) ?? organizations[0];
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [capabilities, setCapabilities] = useState(noCapabilities);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [stepUpAction, setStepUpAction] = useState<(() => void) | null>(null);

  const load = () => {
    if (!organization) return;
    void Promise.all([api.organizations.members(organization.id), api.organizations.invitations(organization.id)])
      .then(([memberResult, invitationResult]) => { setMembers(memberResult.data); setCapabilities(memberResult.capabilities); setInvitations(invitationResult.data); });
  };
  useEffect(load, [organization?.id]);
  const protect = (action: () => Promise<unknown>) => setStepUpAction(() => () => void action().then(load));

  return <div data-testid="organizations-page" className="mx-auto w-full min-w-0 max-w-5xl space-y-6">
    <div><h1 className="text-3xl font-bold">Organizations</h1><p className="text-[var(--color-text-secondary)]">Review memberships and manage organization and project access.</p></div>
    {organizations.length > 1 && <Select aria-label="Organization" value={organization?.id} onChange={(event) => setSelected(event.target.value)} wrapperClassName="w-full min-w-0 sm:w-auto" className="w-full sm:w-auto">{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}
    {!organization ? <p>No organizations are available.</p> : <>
      <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 hover:shadow-md transition-shadow"><h2 className="break-words text-lg font-semibold">{organization.name}</h2><p className="text-sm text-[var(--color-text-secondary)]">Effective role: {capabilities.effectiveRole ?? organization.role}</p></section>
      <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 hover:shadow-md transition-shadow"><h2 className="text-lg font-semibold">Members</h2><ul className="mt-3 divide-y divide-[var(--color-border)]">{members.map((member) => <li key={member.userId} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-medium">{member.displayName}</p><p className="break-all text-sm text-[var(--color-text-muted)]">{member.email}</p></div>{capabilities.canManageMembers ? <div className="flex min-w-0 flex-wrap gap-2"><Select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => protect(() => api.organizations.setMemberRole(organization.id, member.userId, event.target.value))}>{["owner", "admin", "member", "viewer"].map((value) => <option key={value}>{value}</option>)}</Select><button className="rounded border border-[var(--color-border)] px-3 py-2 text-sm" onClick={() => protect(() => api.organizations.removeMember(organization.id, member.userId))}>Remove</button></div> : <span className="text-sm">{member.role}</span>}</li>)}</ul></section>
      {capabilities.canManageInvitations && <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 hover:shadow-md transition-shadow"><h2 className="text-lg font-semibold">Invitations</h2><form className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); protect(() => api.organizations.invite(organization.id, email, role).then((result) => { setEmail(""); return result; })); }}><div className="min-w-0"><label htmlFor="invite-email" className="text-sm font-medium">Email</label><input id="invite-email" className={authInput} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><Select aria-label="Invitation role" value={role} onChange={(event) => setRole(event.target.value)} wrapperClassName="self-end"><option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option></Select><button className="self-end rounded bg-blue-600 px-4 py-2 text-white">Invite</button></form><ul className="mt-4 divide-y divide-[var(--color-border)]">{invitations.map((invitation) => <li key={invitation.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words">{invitation.email} · {invitation.role} · {invitation.acceptedAt ? "accepted" : invitation.revokedAt ? "revoked" : "pending"}</span>{!invitation.acceptedAt && !invitation.revokedAt && <button className="rounded border border-[var(--color-border)] px-3 py-2" onClick={() => protect(() => api.organizations.revokeInvitation(organization.id, invitation.id))}>Revoke</button>}</li>)}</ul></section>}
      <ProjectAccessPanel organization={organization} />
    </>}
    <StepUpDialog open={stepUpAction !== null} onClose={() => setStepUpAction(null)} onComplete={() => { const action = stepUpAction; setStepUpAction(null); action?.(); }} />
  </div>;
}
