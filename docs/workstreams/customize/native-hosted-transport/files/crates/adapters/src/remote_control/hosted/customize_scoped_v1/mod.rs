//! Separately versioned Native consent owner. Existing frozen grant/capability contracts remain unchanged.
use super::{
    AccessProfiles, AccountVault, Enrollment, Error, GrantView, Scope, SessionConnection, Store,
    hash, now,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
pub mod contracts;
pub mod policy;
mod wire;
use contracts::*;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsentCommand {
    pub operation_id: String,
    pub review: ConsentReview,
    pub review_sha256: String,
    pub selection: Selection,
    pub local_policy: crate::access_profiles::Policy,
    pub credential_file: Option<PathBuf>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Retained {
    pub original: Original,
    pub private_owner: Enrollment,
    pub connection: super::ConnectionView,
    pub scope_owner: Consent,
}
pub fn request_hash(value: &impl Serialize) -> Result<String, Error> {
    wire::digest(value)
}
pub fn recovery_key(consent: &Consent) -> String {
    hash(format!("{}/{}", PROTOCOL, consent.original.id).as_bytes())
}
fn same(a: &impl Serialize, b: &impl Serialize) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}
fn err(_: crate::account_vault::Error) -> Error {
    Error::Unavailable
}
impl Store {
    pub fn scoped_consent(&self, id: &str, connection_id: &str) -> Result<Consent, Error> {
        if !crate::utility_operations::canonical(id) {
            return Err(Error::Invalid);
        }
        self.access(
            |db| {
                let c = db.scoped_customize_v1.get(id).ok_or(Error::NotFound)?;
                let parent = db
                    .connections
                    .get(connection_id)
                    .and_then(|c| c.node_hosted.as_ref())
                    .ok_or(Error::Forbidden)?;
                if c.original.base_binding.connection_id != connection_id
                    || parent.customize_scoped_v1_owner.as_deref() != Some(PROTOCOL)
                    || c.original.account_id != parent.account_review.account.id
                    || !same(&c.original.native_owner, &parent.native_owner)
                {
                    return Err(Error::Forbidden);
                }
                Ok(c.clone())
            },
            false,
        )
    }
    pub fn scoped_for_enrollment(
        &self,
        id: &str,
        enrollment: &str,
        actor: &str,
        installation: &str,
    ) -> Result<Consent, Error> {
        let consent = self.access(
            |db| {
                db.scoped_customize_v1
                    .get(id)
                    .cloned()
                    .ok_or(Error::NotFound)
            },
            false,
        )?;
        let connection = self.hosted(&consent.original.base_binding.connection_id)?;
        if connection.enrollment().enrollment_request_id != enrollment
            || consent.original.base_binding.actor_id != actor
            || consent.original.base_binding.installation_id != installation
        {
            return Err(Error::Forbidden);
        }
        self.scoped_consent(id, &connection.view().id)
    }
    pub fn scoped_inventory(&self, connection_id: &str) -> Result<Vec<Value>, Error> {
        self.access(|db|Ok(db.scoped_customize_v1.values().filter(|c|c.original.base_binding.connection_id==connection_id).map(|c|json!({"consentId":c.original.id,"requestSha256":c.request_sha256,"revision":c.revision,"state":c.state,"selection":c.original.selection,"localPolicy":c.original.local_policy,"baseBinding":c.original.base_binding})).collect()),false)
    }
    fn retain_scoped(
        &self,
        connection: &SessionConnection,
        consent: &Consent,
    ) -> Result<(), Error> {
        self.require_hosted(connection)?;
        if consent.original.protocol != PROTOCOL
            || consent.revision != 1
            || consent.state != ConsentState::Prepared
            || !consent.original.selection.validate()
            || !same(
                &consent.original.base_binding,
                &connection.enrollment().identity.binding,
            )
            || consent.request_sha256 != wire::digest(&consent.original)?
        {
            return Err(Error::Invalid);
        }
        self.access(
            |db| {
                if db.scoped_customize_v1.contains_key(&consent.original.id)
                    || db.scoped_customize_v1.len() >= 256
                {
                    return Err(Error::Conflict);
                }
                let e = db
                    .connections
                    .get_mut(&connection.view().id)
                    .and_then(|c| c.node_hosted.as_mut())
                    .ok_or(Error::Forbidden)?;
                if !same(e, connection.enrollment()) {
                    return Err(Error::Conflict);
                }
                e.customize_scoped_v1_owner = Some(PROTOCOL.into());
                db.scoped_customize_v1
                    .insert(consent.original.id.clone(), consent.clone());
                Ok(())
            },
            true,
        )
    }
    fn scoped_state(
        &self,
        expected: &Consent,
        state: ConsentState,
        receipt: Option<NodeConsentReceipt>,
    ) -> Result<Consent, Error> {
        self.access(
            |db| {
                let current = db
                    .scoped_customize_v1
                    .get_mut(&expected.original.id)
                    .ok_or(Error::NotFound)?;
                if !same(current, expected)
                    || !matches!(
                        (current.state, state),
                        (ConsentState::Prepared, ConsentState::Active)
                            | (ConsentState::Prepared, ConsentState::Unconfirmed)
                            | (ConsentState::Unconfirmed, ConsentState::Active)
                            | (ConsentState::Prepared, ConsentState::Revoked)
                            | (ConsentState::Active, ConsentState::Revoked)
                            | (ConsentState::Unconfirmed, ConsentState::Revoked)
                    )
                {
                    return Err(Error::Conflict);
                }
                current.state = state;
                current.node_receipt = receipt;
                Ok(current.clone())
            },
            true,
        )
    }
    /// Actual step-up is allowed only from the exact still-live old account session.
    /// Refresh that verified account metadata without changing any frozen grant or capability.
    fn scoped_step_up_review(
        &self,
        connection: &SessionConnection,
        consent: &Consent,
        review: crate::account_vault::node_hosted::AccountReview,
    ) -> Result<Consent, Error> {
        self.access(
            |db| {
                let parent = db
                    .connections
                    .get_mut(&connection.view().id)
                    .and_then(|p| p.node_hosted.as_mut())
                    .ok_or(Error::NotFound)?;
                let current = db
                    .scoped_customize_v1
                    .get_mut(&consent.original.id)
                    .ok_or(Error::NotFound)?;
                if !same(current, consent)
                    || !same(&parent.account_review, &consent.account_review)
                    || !same(&review.account, &consent.account_review.account)
                    || review.session_revision == consent.account_review.session_revision
                {
                    return Err(Error::Conflict);
                }
                parent.account_review = review.clone();
                current.account_review = review;
                Ok(current.clone())
            },
            true,
        )
    }
    pub fn revoke_scoped_local(&self, consent: &Consent) -> Result<Consent, Error> {
        if consent.state == ConsentState::Revoked {
            return Ok(consent.clone());
        }
        self.scoped_state(consent, ConsentState::Revoked, consent.node_receipt.clone())
    }
    pub fn scoped_local_proof(
        &self,
        consent_id: &str,
        connection_id: &str,
        context: Value,
        profiles: &AccessProfiles,
        purpose: &str,
    ) -> Result<Proof, Error> {
        let consent = self.scoped_consent(consent_id, connection_id)?;
        let connection = self.hosted(connection_id)?;
        if (purpose == "prepare" && consent.state != ConsentState::Prepared)
            || (purpose == "domain" && consent.state != ConsentState::Active)
            || !["prepare", "domain"].contains(&purpose)
        {
            return Err(Error::Forbidden);
        }
        // Custodian/current Native owner has already been validated by the actual paired TLS route.
        let (effective, local_revision, parent_revision) =
            policy::proof_profiles(profiles, &consent, &connection.enrollment().identity)?;
        Ok(Proof {
            protocol: PROTOCOL.into(),
            context,
            original: consent.original,
            request_sha256: consent.request_sha256,
            consent_revision: consent.revision,
            state: consent.state,
            effective_verbs: effective,
            local_profile_revision: local_revision,
            parent_profile_revision: parent_revision,
        })
    }
}
impl SessionConnection {
    pub fn scoped_review(
        &self,
        vault: &AccountVault,
        profiles: &AccessProfiles,
        owner: &super::contracts::NativeOwner,
    ) -> Result<ConsentReview, Error> {
        let identity = self.identity(vault, owner)?;
        let parent = policy::parent(profiles, &identity, false)?;
        let offered = vault
            .with_node_hosted_session(&self.target(), &self.enrollment().account_review, |s| {
                wire::offer(&self.target(), &s, &identity.binding.grant_id)
                    .map_err(|_| crate::account_vault::Error::Unavailable)
            })
            .map_err(err)?;
        if offered["protocol"] != PROTOCOL || offered["baseBinding"] != json!(identity.binding) {
            return Err(Error::Conflict);
        }
        let mut selection: Selection =
            serde_json::from_value(offered["selection"].clone()).map_err(|_| Error::Unavailable)?;
        if !selection.validate() {
            return Err(Error::Unavailable);
        }
        let writable = policy::parent_writable(profiles, &identity);
        selection.verbs.retain(|v| !v.mutating() || writable);
        if !selection.validate() {
            return Err(Error::Forbidden);
        }
        Ok(ConsentReview {
            protocol: PROTOCOL.into(),
            base_binding: identity.binding,
            native_owner: owner.clone(),
            account_id: self.enrollment().account_review.account.id.clone(),
            offered: selection,
            parent_profile_revision: parent.revision,
            current_account_review: self.enrollment().account_review.clone(),
            needs_step_up: offered["recentStepUp"] != true,
            node_offer: offered,
        })
    }
    /// Caller must hold serial/commands and retain its real remote_admin original before this method.
    pub fn scoped_consent_command(
        &self,
        state: &Path,
        store: &Store,
        input: &ConsentCommand,
        owner: &super::contracts::NativeOwner,
    ) -> Result<Consent, Error> {
        if !crate::utility_operations::canonical(&input.operation_id)
            || input.review.protocol != PROTOCOL
            || input.review_sha256 != wire::digest(&input.review)?
            || !input.selection.validate()
        {
            return Err(Error::Invalid);
        }
        let vault = AccountVault::new(state);
        let profiles = AccessProfiles::new(state);
        let review = self.scoped_review(&vault, &profiles, owner)?;
        if !same(&review, &input.review)
            || input
                .selection
                .scopes
                .iter()
                .any(|s| !review.offered.scopes.contains(s))
            || input
                .selection
                .verbs
                .iter()
                .any(|v| !review.offered.verbs.contains(v))
        {
            return Err(Error::Conflict);
        }
        let original = ConsentOriginal {
            protocol: PROTOCOL.into(),
            id: input.operation_id.clone(),
            base_binding: review.base_binding,
            native_owner: owner.clone(),
            account_id: review.account_id,
            selection: input.selection.clone(),
            local_policy: input.local_policy.clone(),
            review_sha256: input.review_sha256.clone(),
        };
        let mut consent = Consent {
            request_sha256: wire::digest(&original)?,
            original,
            revision: 1,
            state: ConsentState::Prepared,
            account_review: review.current_account_review,
            node_receipt: None,
            created_at: now(),
        };
        crate::access_profiles::validate_policy(
            &policy::grant(&consent).scope,
            &input.local_policy,
        )
        .map_err(|_| Error::Forbidden)?;
        if profiles
            .inventory()
            .map_err(|_| Error::Unavailable)?
            .iter()
            .any(|p| p.grant_id == consent.original.id)
            || store.grants()?.iter().any(|g| g.id == consent.original.id)
        {
            return Err(Error::Conflict);
        }
        store.retain_scoped(self, &consent)?;
        let result = (|| {
            let grant = policy::grant(&consent);
            profiles
                .configure_exact(&grant, 0, None, input.local_policy.clone(), now(), || {
                    let journal = crate::utility_operations::Store::open(state)
                        .map_err(|_| crate::access_profiles::Error::Unavailable)?;
                    journal
                        .hosted_effect_resource_has_custody(
                            &self.enrollment().enrollment_request_id,
                        )
                        .map(|held| !held)
                        .map_err(|_| crate::access_profiles::Error::Unavailable)
                })
                .map_err(|_| Error::Forbidden)?;
            if review.needs_step_up {
                let path = input.credential_file.as_deref().ok_or(Error::Invalid)?;
                let actual = vault
                    .node_hosted_scoped_step_up(
                        &self.target(),
                        &consent.account_review,
                        &input.operation_id,
                        path,
                    )
                    .map_err(err)?;
                consent = store.scoped_step_up_review(self, &consent, actual)?;
            } else if input.credential_file.is_some() {
                return Err(Error::Invalid);
            }
            let current = store.hosted(&self.view().id)?;
            let receipt = vault
                .with_node_hosted_session(&current.target(), &consent.account_review, |s| {
                    wire::register(
                        &current.target(),
                        &s,
                        &current.enrollment().enrollment_request_id,
                        &consent,
                    )
                    .map_err(|_| crate::account_vault::Error::Unavailable)
                })
                .map_err(err)?;
            store.scoped_state(&consent, ConsentState::Active, Some(receipt))
        })();
        if result.is_err() {
            let _ = store.scoped_state(&consent, ConsentState::Unconfirmed, None);
        }
        result
    }
    /// Explicit original reconciliation; a metadata GET alone never activates a consent.
    pub fn scoped_reconcile_registration(
        &self,
        vault: &AccountVault,
        profiles: &AccessProfiles,
        store: &Store,
        consent: &Consent,
        owner: &super::contracts::NativeOwner,
    ) -> Result<Consent, Error> {
        if !matches!(
            consent.state,
            ConsentState::Prepared | ConsentState::Unconfirmed | ConsentState::Active
        ) {
            return Err(Error::Conflict);
        }
        let identity = self.identity(vault, owner)?;
        if !same(&identity.binding, &consent.original.base_binding) {
            return Err(Error::Conflict);
        }
        let (verbs, _, _) = policy::proof_profiles(profiles, consent, &identity)?;
        if consent
            .original
            .selection
            .verbs
            .iter()
            .any(|v| !verbs.contains(v))
        {
            return Err(Error::Forbidden);
        }
        let metadata = self.scoped_registration_receipt(vault, consent)?;
        if metadata["revoked"] != false || metadata["revision"] != 1 {
            return Err(Error::Forbidden);
        }
        let receipt: NodeConsentReceipt =
            serde_json::from_value(metadata["receipt"].clone()).map_err(|_| Error::Unavailable)?;
        wire::validate_registration(&receipt, consent, &self.enrollment().enrollment_request_id)?;
        store.require_hosted(self)?;
        if consent.state == ConsentState::Active {
            Ok(consent.clone())
        } else {
            store.scoped_state(consent, ConsentState::Active, Some(receipt))
        }
    }
    pub fn scoped_revoke(
        &self,
        state: &Path,
        store: &Store,
        consent: &Consent,
    ) -> Result<Value, Error> {
        let local = store.revoke_scoped_local(consent)?;
        let profiles = AccessProfiles::new(state);
        let profile = profiles
            .inventory()
            .map_err(|_| Error::Unavailable)?
            .into_iter()
            .find(|p| p.grant_id == consent.original.id);
        if let Some(profile) = profile {
            if !profile.revoked {
                profiles
                    .revoke_exact(
                        &consent.original.id,
                        profile.revision,
                        Some(&profile),
                        false,
                        now(),
                    )
                    .map_err(|_| Error::Conflict)?;
            }
        } else {
            profiles
                .revoke_exact(&consent.original.id, 0, None, false, now())
                .map_err(|_| Error::Conflict)?;
        }
        // Missing profile becomes a real persisted revocation tombstone; absence is never revocation proof.
        let vault = AccountVault::new(state);
        let metadata = self.scoped_registration_receipt(&vault, &local)?;
        let expected = metadata["revision"]
            .as_u64()
            .filter(|v| *v >= 1 && *v <= u32::MAX as u64)
            .ok_or(Error::Unavailable)? as u32;
        let node = vault
            .with_node_hosted_retirement_session(
                &self.target(),
                &local.account_review,
                &self.enrollment().enrollment_request_id,
                &local.original.base_binding,
                |session| {
                    wire::revoke(&self.target(), &session, &local, expected)
                        .map_err(|_| crate::account_vault::Error::Unavailable)
                },
            )
            .map_err(err)?;
        let profile_revoked = profiles
            .inventory()
            .map_err(|_| Error::Unavailable)?
            .into_iter()
            .find(|p| p.grant_id == consent.original.id)
            .is_some_and(|p| p.revoked);
        if store
            .scoped_consent(&consent.original.id, &self.view().id)?
            .state
            != ConsentState::Revoked
            || !profile_revoked
        {
            return Err(Error::Conflict);
        }
        Ok(
            json!({"consent_id":consent.original.id,"request_sha256":consent.request_sha256,"local_consent_revoked":true,"local_profile_revoked":profile_revoked,"node":node,"physical_erasure":false}),
        )
    }
    pub fn scoped_context(&self, vault: &AccountVault, consent: &Consent) -> Result<Value, Error> {
        vault
            .with_node_hosted_session(&self.target(), &consent.account_review, |s| {
                wire::context(&self.target(), &s, consent)
                    .map_err(|_| crate::account_vault::Error::Unavailable)
            })
            .map_err(err)
    }
    pub fn scoped_read(
        &self,
        vault: &AccountVault,
        profiles: &AccessProfiles,
        consent: &Consent,
        current: &super::contracts::Identity,
        input: &ReadRequest,
    ) -> Result<Value, Error> {
        if input.protocol != PROTOCOL
            || input.consent_id != consent.original.id
            || input.consent_revision != consent.revision
            || input.verb.mutating()
        {
            return Err(Error::Invalid);
        }
        policy::current(profiles, consent, current, input.verb)?;
        vault
            .with_node_hosted_session(&self.target(), &consent.account_review, |s| {
                wire::read(&self.target(), &s, input)
                    .map_err(|_| crate::account_vault::Error::Unavailable)
            })
            .map_err(err)
    }
    pub fn scoped_send(
        &self,
        vault: &AccountVault,
        profiles: &AccessProfiles,
        consent: &Consent,
        current: &super::contracts::Identity,
        original: &Original,
    ) -> Result<Receipt, Error> {
        let verb: Verb =
            serde_json::from_value(original.command["op"].clone()).map_err(|_| Error::Invalid)?;
        if original.protocol != PROTOCOL
            || original.consent_id != consent.original.id
            || original.consent_revision != consent.revision
            || original.consent_request_sha256 != consent.request_sha256
            || original.command["operationId"] != original.id
            || !same(&original.base_binding, &current.binding)
        {
            return Err(Error::Conflict);
        }
        if policy::verify_admitted(profiles, consent, current, original)? != verb {
            return Err(Error::Forbidden);
        }
        vault
            .with_node_hosted_session(&self.target(), &consent.account_review, |s| {
                wire::effect(&self.target(), &s, original)
                    .map_err(|_| crate::account_vault::Error::Unavailable)
            })
            .map_err(err)
    }
    pub fn scoped_receipt(
        &self,
        vault: &AccountVault,
        consent: &Consent,
        original: &Original,
    ) -> Result<Value, Error> {
        if original.consent_id != consent.original.id
            || original.consent_request_sha256 != consent.request_sha256
        {
            return Err(Error::Conflict);
        }
        vault
            .with_node_hosted_retirement_session(
                &self.target(),
                &consent.account_review,
                &self.enrollment().enrollment_request_id,
                &consent.original.base_binding,
                |s| {
                    wire::operation_receipt(&self.target(), &s, original)
                        .map_err(|_| crate::account_vault::Error::Unavailable)
                },
            )
            .map_err(err)
    }
    pub fn scoped_registration_receipt(
        &self,
        vault: &AccountVault,
        consent: &Consent,
    ) -> Result<Value, Error> {
        vault
            .with_node_hosted_retirement_session(
                &self.target(),
                &consent.account_review,
                &self.enrollment().enrollment_request_id,
                &consent.original.base_binding,
                |s| {
                    wire::registration_receipt(
                        &self.target(),
                        &s,
                        consent,
                        &self.enrollment().enrollment_request_id,
                    )
                    .map_err(|_| crate::account_vault::Error::Unavailable)
                },
            )
            .map_err(err)
    }
}
