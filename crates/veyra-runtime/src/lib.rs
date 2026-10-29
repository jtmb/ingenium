//! Progressive migration ledger. This crate has no storage, scheduler, inference or writer API.

/// Recorded owner of all database writes, migrations, sessions and audit events.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DatabaseAuthority {
    /// Existing authenticated Node API, including all of its auth side effects.
    IngeniumApi,
}

/// Domain admission states; a proposal is never a traffic or write authorization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainStage {
    /// Existing implementation owns all requests.
    Legacy,
    /// Only the fixed project-read compatibility edge can be exercised.
    ReadOnlyCompatibility,
    /// Requires a separately recorded architecture decision and parity evidence.
    ProposedWritable,
}

/// Domain owner and explicit migration gate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DomainMigration {
    /// Stable domain identifier; not a user-selected resource or project.
    pub domain: &'static str,
    /// Current source admission.
    pub stage: DomainStage,
    /// Sole database writer.
    pub database_authority: DatabaseAuthority,
    /// Independent approval is still required before production write migration.
    pub architecture_approval_required: bool,
}

/// Initial migration allocation. Unlisted domains are implicitly legacy-owned.
pub const DOMAINS: &[DomainMigration] = &[
    DomainMigration {
        domain: "projects",
        stage: DomainStage::ReadOnlyCompatibility,
        database_authority: DatabaseAuthority::IngeniumApi,
        architecture_approval_required: true,
    },
    DomainMigration {
        domain: "identity-auth-capabilities",
        stage: DomainStage::Legacy,
        database_authority: DatabaseAuthority::IngeniumApi,
        architecture_approval_required: true,
    },
];

/// Linux packaging has no Windows inference-engine capability.
pub const LINUX_INFERENCE_ENGINE_INCLUDED: bool = false;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_initial_domain_retains_one_writer_and_the_approval_gate() {
        assert!(!DOMAINS.is_empty());
        for domain in DOMAINS {
            assert_eq!(domain.database_authority, DatabaseAuthority::IngeniumApi);
            assert!(domain.architecture_approval_required);
            assert_ne!(domain.stage, DomainStage::ProposedWritable);
        }
    }
}
