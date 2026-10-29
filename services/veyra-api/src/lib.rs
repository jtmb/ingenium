//! Loopback-only, bounded project-read compatibility edge with no local identity or database.
use axum::{
    body::Body,
    extract::State,
    http::{Request, Response, StatusCode},
    Router,
};
use reqwest::{redirect::Policy, Client, Url};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use veyra_auth::{capability, forward_headers, BoundaryError};

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Immutable upstream configuration. Credentials are supplied afresh by each caller.
#[derive(Clone)]
pub struct CompatibilityEdge {
    client: Client,
    origin: Url,
}

impl CompatibilityEdge {
    /// Admit only an explicit loopback HTTP origin; redirects and environment proxies are disabled.
    pub fn new(origin: &str) -> Result<Self, &'static str> {
        let origin = Url::parse(origin).map_err(|_| "Invalid legacy API origin")?;
        let loopback = origin
            .host_str()
            .is_some_and(|host| host == "127.0.0.1" || host == "[::1]" || host == "::1");
        if origin.scheme() != "http"
            || !loopback
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err("Legacy API must be an explicit loopback HTTP origin");
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| "Cannot configure legacy API transport")?;
        Ok(Self { client, origin })
    }

    /// Construct a fallback router so implicit HEAD/OPTIONS do not widen the read capability.
    pub fn router(self) -> Router {
        Router::new().fallback(read_compatibility).with_state(self)
    }
}

fn failure(status: StatusCode, code: &str, message: &str) -> Response<Body> {
    let body = serde_json::json!({"error": {
        "code": code, "message": message, "details": null,
        "requestId": format!("veyra_{}", REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed))
    }});
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        "content-type",
        http::HeaderValue::from_static("application/json"),
    );
    response
        .headers_mut()
        .insert("cache-control", http::HeaderValue::from_static("no-store"));
    response
}

async fn read_compatibility(
    State(edge): State<CompatibilityEdge>,
    request: Request<Body>,
) -> Response<Body> {
    if capability(request.method(), request.uri().path()).is_err() {
        return failure(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found");
    }
    let headers = match forward_headers(request.headers()) {
        Ok(headers) => headers,
        Err(BoundaryError::NotFound) => {
            return failure(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
        }
        Err(_) => {
            return failure(
                StatusCode::BAD_REQUEST,
                "INVALID_REQUEST_HEADERS",
                "Invalid request headers",
            )
        }
    };
    // GET bodies are never forwarded; legacy query bytes remain intact, including organization_id.
    let mut url = edge.origin.clone();
    url.set_path(request.uri().path());
    url.set_query(request.uri().query());
    let mut upstream = match edge.client.get(url).headers(headers).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return failure(
                StatusCode::GATEWAY_TIMEOUT,
                "UPSTREAM_TIMEOUT",
                "Legacy API timed out",
            )
        }
        Err(_) => {
            return failure(
                StatusCode::BAD_GATEWAY,
                "UPSTREAM_UNAVAILABLE",
                "Legacy API is unavailable",
            )
        }
    };
    if upstream.status().is_redirection() {
        return failure(
            StatusCode::BAD_GATEWAY,
            "UPSTREAM_REDIRECT_REJECTED",
            "Legacy API returned an unexpected redirect",
        );
    }
    let mut response = Response::new(Body::empty());
    *response.status_mut() = upstream.status();
    for name in [
        "content-type",
        "content-encoding",
        "vary",
        "www-authenticate",
        "retry-after",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
    ] {
        for value in upstream.headers().get_all(name) {
            response.headers_mut().append(name, value.clone());
        }
    }
    response
        .headers_mut()
        .insert("cache-control", http::HeaderValue::from_static("no-store"));
    let mut body = Vec::new();
    loop {
        match upstream.chunk().await {
            Ok(Some(chunk)) if chunk.len() <= MAX_RESPONSE_BYTES.saturating_sub(body.len()) => {
                body.extend_from_slice(&chunk)
            }
            Ok(Some(_)) => {
                return failure(
                    StatusCode::BAD_GATEWAY,
                    "UPSTREAM_RESPONSE_TOO_LARGE",
                    "Legacy API response exceeds the compatibility limit",
                )
            }
            Ok(None) => break,
            Err(error) if error.is_timeout() => {
                return failure(
                    StatusCode::GATEWAY_TIMEOUT,
                    "UPSTREAM_TIMEOUT",
                    "Legacy API timed out",
                )
            }
            Err(_) => {
                return failure(
                    StatusCode::BAD_GATEWAY,
                    "UPSTREAM_UNAVAILABLE",
                    "Legacy API is unavailable",
                )
            }
        }
    }
    *response.body_mut() = Body::from(body);
    response
}
