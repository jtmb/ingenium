//! Distinct managed local grant; old governance permission is only an additional parent safety constraint.
use super::{contracts::*, *};
use crate::access_profiles::{AccessProfiles, Profile};
pub fn grant(consent: &Consent) -> GrantView {
    let mut permissions = vec![READ_PERMISSION.into()];
    if consent.original.selection.writable() {
        permissions.push(WRITE_PERMISSION.into());
    }
    GrantView {
        id: consent.original.id.clone(),
        revision: 1,
        scope: Scope {
            name: "Scoped Customize consent v1".into(),
            project_ids: consent
                .original
                .native_owner
                .project
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            permissions,
        },
        revoked: consent.state == ConsentState::Revoked,
        created_at: consent.created_at,
    }
}
fn room(p: &Profile) -> bool {
    p.max_mutating_admissions
        .is_none_or(|max| p.used_mutating_admissions < max)
}
fn managed(profiles: &AccessProfiles, id: &str) -> Result<Profile, Error> {
    profiles
        .inventory()
        .map_err(|_| Error::Unavailable)?
        .into_iter()
        .find(|p| p.grant_id == id)
        .ok_or(Error::Forbidden)
}
pub fn parent(
    profiles: &AccessProfiles,
    identity: &super::super::contracts::Identity,
    write: bool,
) -> Result<Profile, Error> {
    let p = managed(profiles, &identity.binding.grant_id)?;
    let effective = profiles
        .effective_grant(&super::super::policy_grant(identity), now())
        .map_err(|_| Error::Forbidden)?;
    let required = if write {
        "hosted_governance_write"
    } else {
        "hosted_governance_read"
    };
    if !effective.scope.permissions.iter().any(|v| v == required) {
        return Err(Error::Forbidden);
    }
    Ok(p)
}
fn current_inner(
    profiles: &AccessProfiles,
    consent: &Consent,
    identity: &super::super::contracts::Identity,
    verb: Verb,
    check_room: bool,
) -> Result<(Profile, Profile), Error> {
    if consent.state != ConsentState::Active
        || consent.revision != 1
        || !consent.original.selection.verbs.contains(&verb)
        || json!(identity.binding) != json!(consent.original.base_binding)
    {
        return Err(Error::Forbidden);
    }
    let parent = parent(profiles, identity, verb.mutating())?;
    let local = managed(profiles, &consent.original.id)?;
    let effective = profiles
        .effective_grant(&grant(consent), now())
        .map_err(|_| Error::Forbidden)?;
    if check_room && verb.mutating() && (!room(&parent) || !room(&local)) {
        return Err(Error::Forbidden);
    }
    let required = if verb.mutating() {
        WRITE_PERMISSION
    } else {
        READ_PERMISSION
    };
    if !effective.scope.permissions.iter().any(|v| v == required) {
        return Err(Error::Forbidden);
    }
    Ok((local, parent))
}
/// Proof generation is local-only: no vault lock or Node request while Node awaits this proof.
pub fn proof_profiles(
    profiles: &AccessProfiles,
    consent: &Consent,
    parent_identity: &super::super::contracts::Identity,
) -> Result<(Vec<Verb>, u32, u32), Error> {
    let parent = parent(profiles, parent_identity, false)?;
    let local = managed(profiles, &consent.original.id)?;
    if !matches!(
        consent.state,
        ConsentState::Prepared | ConsentState::Active | ConsentState::Unconfirmed
    ) {
        return Err(Error::Forbidden);
    }
    let effective = profiles
        .effective_grant(&grant(consent), now())
        .map_err(|_| Error::Forbidden)?;
    let read = effective
        .scope
        .permissions
        .iter()
        .any(|v| v == READ_PERMISSION);
    let write = effective
        .scope
        .permissions
        .iter()
        .any(|v| v == WRITE_PERMISSION)
        && self::parent(profiles, parent_identity, true).is_ok()
        && room(&local)
        && room(&parent);
    Ok((
        consent
            .original
            .selection
            .verbs
            .iter()
            .copied()
            .filter(|v| if v.mutating() { write } else { read })
            .collect(),
        local.revision,
        parent.revision,
    ))
}
pub fn admit(
    profiles: &AccessProfiles,
    consent: &Consent,
    identity: &super::super::contracts::Identity,
    original: &Original,
    verb: Verb,
) -> Result<(), Error> {
    if !verb.mutating() {
        return Err(Error::Invalid);
    }
    current(profiles, consent, identity, verb)?;
    let digest = wire::digest(original)?;
    // A parent admission alone never permits a scoped verb. Both managed grants are checked and charged.
    profiles
        .admit(
            &super::super::policy_grant(identity),
            &original.id,
            &digest,
            "hosted_governance_write",
            now(),
        )
        .map_err(|_| Error::Forbidden)?;
    profiles
        .admit(
            &grant(consent),
            &original.id,
            &digest,
            WRITE_PERMISSION,
            now(),
        )
        .map_err(|_| Error::Forbidden)?;
    Ok(())
}
pub fn current(
    profiles: &AccessProfiles,
    consent: &Consent,
    identity: &super::super::contracts::Identity,
    verb: Verb,
) -> Result<(Profile, Profile), Error> {
    current_inner(profiles, consent, identity, verb, true)
}
pub fn verify_admitted(
    profiles: &AccessProfiles,
    consent: &Consent,
    identity: &super::super::contracts::Identity,
    original: &Original,
) -> Result<Verb, Error> {
    let verb: Verb =
        serde_json::from_value(original.command["op"].clone()).map_err(|_| Error::Invalid)?;
    if !verb.mutating() {
        return Err(Error::Invalid);
    }
    current_inner(profiles, consent, identity, verb, false)?;
    let digest = wire::digest(original)?;
    for grant in [&consent.original.id, &identity.binding.grant_id] {
        let ledger = profiles.export(grant).map_err(|_| Error::Forbidden)?;
        if !ledger
            .admissions
            .iter()
            .any(|d| d.operation_id == original.id && d.intent_sha256 == digest)
        {
            return Err(Error::Forbidden);
        }
    }
    Ok(verb)
}

pub fn parent_writable(
    profiles: &AccessProfiles,
    identity: &super::super::contracts::Identity,
) -> bool {
    parent(profiles, identity, true).is_ok_and(|p| room(&p))
}
