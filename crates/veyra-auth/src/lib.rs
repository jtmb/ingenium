//! Narrow transport capability boundary. Existing Ingenium API remains the identity authority.
use http::{HeaderMap, Method};
use thiserror::Error;

/// The complete initial read-only capability set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadCapability {
    /// Existing authorized project collection.
    Projects,
    /// Existing authorized archived-project collection.
    ArchivedProjects,
}

/// Transport refusal; no submitted credential or resource information is reflected.
#[derive(Debug, Error, Eq, PartialEq)]
pub enum BoundaryError {
    /// Route is outside the approved read-only slice.
    #[error("Resource not found")]
    NotFound,
    /// Credential or context headers were ambiguous or exceeded the input budget.
    #[error("Invalid request headers")]
    InvalidHeaders,
}

/// Resolve only exact GET routes; writes and encoded/alternate paths never reach the writer.
pub fn capability(method: &Method, path: &str) -> Result<ReadCapability, BoundaryError> {
    match (method, path) {
        (&Method::GET, "/api/v1/projects") => Ok(ReadCapability::Projects),
        (&Method::GET, "/api/v1/projects/archive") => Ok(ReadCapability::ArchivedProjects),
        _ => Err(BoundaryError::NotFound),
    }
}

/// Caller credential/context fields understood by existing authentication middleware.
pub const REQUEST_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "origin",
    "x-ingenium-ui",
    "x-ingenium-audience",
    "x-ingenium-workspace",
    "x-ingenium-launcher-worktree",
];

/// Select original credentials without minting an installation credential or trusting identity claims.
pub fn forward_headers(headers: &HeaderMap) -> Result<HeaderMap, BoundaryError> {
    // These markers turn bearer credentials into privileged/internal audiences in the Node boundary.
    const PRIVATE: &[&str] = &[
        "x-ingenium-internal-service",
        "x-ingenium-dashboard-service",
        "x-ingenium-mcp-report",
        "x-ingenium-private-network",
        "x-ingenium-storage-mapping-hash",
    ];
    if PRIVATE.iter().any(|name| headers.contains_key(*name)) {
        return Err(BoundaryError::NotFound);
    }
    if headers
        .iter()
        .map(|(name, value)| name.as_str().len() + value.len())
        .sum::<usize>()
        > 16_384
    {
        return Err(BoundaryError::InvalidHeaders);
    }
    // Hop-by-hop nominations must not change which authentication fields arrive upstream.
    for value in headers.get_all("connection") {
        let value = value.to_str().map_err(|_| BoundaryError::InvalidHeaders)?;
        if value.split(',').any(|token| {
            !matches!(
                token.trim().to_ascii_lowercase().as_str(),
                "keep-alive" | "close"
            )
        }) {
            return Err(BoundaryError::InvalidHeaders);
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err(BoundaryError::InvalidHeaders);
    }
    let mut selected = HeaderMap::new();
    for name in REQUEST_HEADERS {
        let values = headers.get_all(*name);
        if values.iter().count() > 1 {
            return Err(BoundaryError::InvalidHeaders);
        }
        if let Some(value) = headers.get(*name) {
            selected.insert(*name, value.clone());
        }
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderValue;

    #[test]
    fn exact_capabilities_never_admit_mutation_or_path_aliases() {
        assert_eq!(
            capability(&Method::GET, "/api/v1/projects"),
            Ok(ReadCapability::Projects)
        );
        assert_eq!(
            capability(&Method::GET, "/api/v1/projects/archive"),
            Ok(ReadCapability::ArchivedProjects)
        );
        for method in [
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::HEAD,
            Method::OPTIONS,
        ] {
            assert_eq!(
                capability(&method, "/api/v1/projects"),
                Err(BoundaryError::NotFound)
            );
        }
        for path in [
            "/api/v1/projects/",
            "/api/v1/Projects",
            "/api/v1/projects/%2e%2e",
            "/api/v1/projects/acme/detail",
            "/api/v1/auth/preflight",
        ] {
            assert_eq!(capability(&Method::GET, path), Err(BoundaryError::NotFound));
        }
    }

    #[test]
    fn credential_precedence_is_left_to_existing_authority() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "cookie",
            HeaderValue::from_static("__Host-ingenium_session=synthetic-invalid"),
        );
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer synthetic-valid"),
        );
        headers.insert("x-forwarded-user", HeaderValue::from_static("forged-admin"));
        let forwarded = forward_headers(&headers).unwrap();
        assert_eq!(forwarded.get("cookie"), headers.get("cookie"));
        assert_eq!(forwarded.get("authorization"), headers.get("authorization"));
        assert!(!forwarded.contains_key("x-forwarded-user"));
        headers.insert("connection", HeaderValue::from_static("keep-alive"));
        assert!(forward_headers(&headers).is_ok());
        assert!(!forward_headers(&headers)
            .unwrap()
            .contains_key("connection"));
    }

    #[test]
    fn private_markers_duplicate_credentials_and_connection_nominations_are_denied() {
        for name in [
            "x-ingenium-internal-service",
            "x-ingenium-dashboard-service",
            "x-ingenium-mcp-report",
            "x-ingenium-private-network",
            "x-ingenium-storage-mapping-hash",
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(name, HeaderValue::from_static("1"));
            assert_eq!(forward_headers(&headers), Err(BoundaryError::NotFound));
        }
        let mut headers = HeaderMap::new();
        headers.append("authorization", HeaderValue::from_static("Bearer first"));
        headers.append("authorization", HeaderValue::from_static("Bearer second"));
        assert_eq!(
            forward_headers(&headers),
            Err(BoundaryError::InvalidHeaders)
        );
        headers.clear();
        headers.insert("connection", HeaderValue::from_static("cookie"));
        assert_eq!(
            forward_headers(&headers),
            Err(BoundaryError::InvalidHeaders)
        );
        headers.clear();
        headers.insert(
            "cookie",
            HeaderValue::from_bytes(&vec![b'a'; 16_385]).unwrap(),
        );
        assert_eq!(
            forward_headers(&headers),
            Err(BoundaryError::InvalidHeaders)
        );
    }
}
