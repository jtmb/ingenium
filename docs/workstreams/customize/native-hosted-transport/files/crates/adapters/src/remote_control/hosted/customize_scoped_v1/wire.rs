//! Closed new wire. Existing frozen wire/recovery whitelist is unchanged.
use super::{Error, contracts::*};
use crate::account_vault::node_hosted::{Session, Target};
use serde::Serialize;
use serde_json::{Value, json};
use std::io::Read;
const BASE: &str = "/api/v1/customize-scoped-v1";
pub fn digest(value: &impl Serialize) -> Result<String, Error> {
    let value = serde_json::to_value(value).map_err(|_| Error::Invalid)?;
    let canonical = super::super::wire::canonical(&value)?;
    if canonical.len() > 2_000_000 {
        return Err(Error::Invalid);
    }
    Ok(super::hash(canonical.as_bytes()))
}
fn url(target: &Target<'_>, path: &str) -> Result<reqwest::Url, Error> {
    let mut u = reqwest::Url::parse(target.endpoint).map_err(|_| Error::Invalid)?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || u.path() != "/"
        || u.query().is_some()
        || u.fragment().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || !path.starts_with(BASE)
    {
        return Err(Error::Invalid);
    }
    u.set_path(path);
    Ok(u)
}
fn decode(response: reqwest::blocking::Response) -> Result<Value, Error> {
    if !response.status().is_success() {
        return Err(Error::Unavailable);
    }
    let mut bytes = Vec::new();
    response
        .take(3 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Unavailable)?;
    if bytes.len() > 3 * 1024 * 1024 {
        return Err(Error::Unavailable);
    }
    let result = serde_json::from_slice::<Value>(&bytes).map_err(|_| Error::Unavailable)?;
    if !result
        .as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("data"))
    {
        return Err(Error::Unavailable);
    }
    Ok(result["data"].clone())
}
fn post(target: &Target<'_>, s: &Session<'_>, path: &str, body: &Value) -> Result<Value, Error> {
    if s.recovery_only {
        return Err(Error::Forbidden);
    }
    decode(
        target
            .client
            .post(url(target, path)?)
            .header(reqwest::header::COOKIE, s.cookie)
            .header(reqwest::header::ORIGIN, target.dashboard_origin)
            .header("x-ingenium-ui", "dashboard")
            .header("x-csrf-token", s.csrf)
            .json(body)
            .send()
            .map_err(|_| Error::Unavailable)?,
    )
}
pub fn offer(target: &Target<'_>, s: &Session<'_>, parent: &str) -> Result<Value, Error> {
    if s.recovery_only {
        return Err(Error::Forbidden);
    }
    decode(
        target
            .client
            .get(url(target, &format!("{BASE}/offer"))?)
            .query(&[("parentGrantId", parent)])
            .header(reqwest::header::COOKIE, s.cookie)
            .send()
            .map_err(|_| Error::Unavailable)?,
    )
}
pub fn register(
    target: &Target<'_>,
    s: &Session<'_>,
    enrollment: &str,
    consent: &Consent,
) -> Result<NodeConsentReceipt, Error> {
    let value = post(
        target,
        s,
        &format!("{BASE}/consents"),
        &json!({"protocol":PROTOCOL,"consentId":consent.original.id,"parentGrantId":consent.original.base_binding.grant_id,"enrollmentRequestId":enrollment,"requestSha256":consent.request_sha256}),
    )?;
    let receipt: NodeConsentReceipt =
        serde_json::from_value(value).map_err(|_| Error::Unavailable)?;
    validate_registration(&receipt, consent, enrollment)?;
    Ok(receipt)
}
pub fn validate_registration(
    receipt: &NodeConsentReceipt,
    consent: &Consent,
    enrollment: &str,
) -> Result<(), Error> {
    let b = &consent.original.base_binding;
    if receipt.protocol != PROTOCOL
        || receipt.consent_id != consent.original.id
        || receipt.revision != consent.revision
        || receipt.request_sha256 != consent.request_sha256
        || receipt.actor_id != b.actor_id
        || receipt.installation_id != b.installation_id
        || receipt.enrollment_request_id != enrollment
        || receipt.base_binding_sha256 != digest(b)?
        || json!(receipt.selection) != json!(consent.original.selection)
        || receipt.physical_erasure
    {
        return Err(Error::Conflict);
    }
    Ok(())
}
pub fn read(target: &Target<'_>, s: &Session<'_>, input: &ReadRequest) -> Result<Value, Error> {
    let result = post(target, s, &format!("{BASE}/read"), &json!(input))?;
    if result["protocol"] != PROTOCOL
        || result["consentId"] != input.consent_id
        || result["consentRevision"] != input.consent_revision
        || !result
            .as_object()
            .is_some_and(|o| o.len() == 4 && o.contains_key("value"))
    {
        return Err(Error::Conflict);
    }
    Ok(result["value"].clone())
}
pub fn effect(target: &Target<'_>, s: &Session<'_>, original: &Original) -> Result<Receipt, Error> {
    let result = post(target, s, &format!("{BASE}/effects"), &json!(original))?;
    let receipt: Receipt = serde_json::from_value(result).map_err(|_| Error::Unavailable)?;
    if receipt.protocol != PROTOCOL
        || receipt.operation_id != original.id
        || receipt.native_request_sha256 != digest(original)?
        || receipt.consent_id != original.consent_id
    {
        return Err(Error::Conflict);
    }
    Ok(receipt)
}
/// Recovery can only read these two fixed metadata paths. No new command/domain request.
pub fn registration_receipt(
    target: &Target<'_>,
    s: &Session<'_>,
    consent: &Consent,
    enrollment: &str,
) -> Result<Value, Error> {
    if !crate::utility_operations::canonical(&consent.original.id) {
        return Err(Error::Invalid);
    }
    let result = decode(
        target
            .client
            .get(url(
                target,
                &format!("{BASE}/consents/{}/receipt", consent.original.id),
            )?)
            .query(&[("requestSha256", &consent.request_sha256)])
            .header(reqwest::header::COOKIE, s.cookie)
            .send()
            .map_err(|_| Error::Unavailable)?,
    )?;
    if result["liveBinding"] != false || result["domainReadback"] != "not_requested" {
        return Err(Error::Conflict);
    }
    let receipt: NodeConsentReceipt =
        serde_json::from_value(result["receipt"].clone()).map_err(|_| Error::Unavailable)?;
    validate_registration(&receipt, consent, enrollment)?;
    Ok(result)
}
pub fn operation_receipt(
    target: &Target<'_>,
    s: &Session<'_>,
    original: &Original,
) -> Result<Value, Error> {
    if !crate::utility_operations::canonical(&original.id)
        || !crate::utility_operations::canonical(&original.consent_id)
    {
        return Err(Error::Invalid);
    }
    let digest = digest(original)?;
    let result = decode(
        target
            .client
            .get(url(
                target,
                &format!(
                    "{BASE}/consents/{}/operations/{}",
                    original.consent_id, original.id
                ),
            )?)
            .query(&[("nativeRequestSha256", &digest)])
            .header(reqwest::header::COOKIE, s.cookie)
            .send()
            .map_err(|_| Error::Unavailable)?,
    )?;
    if result["protocol"] != PROTOCOL
        || result["operationId"] != original.id
        || result["consentId"] != original.consent_id
        || result["nativeRequestSha256"] != digest
        || result["liveBinding"] != false
        || result["domainReadback"] != "not_requested"
        || !["unknown", "succeeded", "refused"].contains(&result["outcome"].as_str().unwrap_or(""))
    {
        return Err(Error::Conflict);
    }
    Ok(result)
}
pub fn context(target: &Target<'_>, s: &Session<'_>, consent: &Consent) -> Result<Value, Error> {
    if s.recovery_only || !crate::utility_operations::canonical(&consent.original.id) {
        return Err(Error::Forbidden);
    }
    let revision = consent.revision.to_string();
    let result = decode(
        target
            .client
            .get(url(
                target,
                &format!("{BASE}/consents/{}/context", consent.original.id),
            )?)
            .query(&[
                ("requestSha256", consent.request_sha256.as_str()),
                ("consentRevision", revision.as_str()),
            ])
            .header(reqwest::header::COOKIE, s.cookie)
            .send()
            .map_err(|_| Error::Unavailable)?,
    )?;
    if result["protocol"] != PROTOCOL
        || result["consentId"] != consent.original.id
        || result["consentRevision"] != consent.revision
        || result["consentRequestSha256"] != consent.request_sha256
        || result["baseBinding"] != json!(consent.original.base_binding)
        || result["selection"] != json!(consent.original.selection)
    {
        return Err(Error::Conflict);
    }
    let verbs: Vec<Verb> =
        serde_json::from_value(result["capabilities"].clone()).map_err(|_| Error::Unavailable)?;
    if verbs
        .iter()
        .any(|v| !consent.original.selection.verbs.contains(v))
    {
        return Err(Error::Forbidden);
    }
    Ok(result)
}

/// Only this fixed, authority-reducing command may use a same-account recovery session.
pub fn revoke(
    target: &Target<'_>,
    s: &Session<'_>,
    consent: &Consent,
    expected_revision: u32,
) -> Result<Value, Error> {
    if !crate::utility_operations::canonical(&consent.original.id) {
        return Err(Error::Invalid);
    }
    let response = target
        .client
        .post(url(
            target,
            &format!("{BASE}/consents/{}/revoke", consent.original.id),
        )?)
        .header(reqwest::header::COOKIE, s.cookie)
        .header(reqwest::header::ORIGIN, target.dashboard_origin)
        .header("x-ingenium-ui", "dashboard")
        .header("x-csrf-token", s.csrf)
        .json(&json!({"requestSha256":consent.request_sha256,"expectedRevision":expected_revision}))
        .send()
        .map_err(|_| Error::Unavailable)?;
    let result = decode(response)?;
    if result["consentId"] != consent.original.id
        || result["revoked"] != true
        || result["physicalErasure"] != false
        || !result["revision"]
            .as_u64()
            .is_some_and(|v| v >= 2 && v <= u32::MAX as u64)
    {
        return Err(Error::Conflict);
    }
    Ok(result)
}
