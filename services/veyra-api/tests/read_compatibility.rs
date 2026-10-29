use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{Request, Response, StatusCode},
    Router,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tower::ServiceExt;
use veyra_api::CompatibilityEdge;

struct Upstream {
    origin: String,
    calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Upstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn upstream(status: StatusCode, body: &'static str) -> Upstream {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let app = Router::new()
        .fallback(
            move |State(count): State<Arc<AtomicUsize>>, request: Request<Body>| async move {
                count.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.method(), "GET");
                assert!(!request.headers().contains_key("x-forwarded-user"));
                let mut response = Response::new(Body::from(body));
                *response.status_mut() = status;
                response
                    .headers_mut()
                    .insert("content-type", "application/json".parse().unwrap());
                response.headers_mut().insert(
                    "www-authenticate",
                    "Bearer realm=\"ingenium\"".parse().unwrap(),
                );
                response
                    .headers_mut()
                    .insert("retry-after", "19".parse().unwrap());
                if request.uri().query() == Some("organization_id=org-a") {
                    assert_eq!(
                        request.headers().get("cookie").unwrap(),
                        "__Host-ingenium_session=synthetic-invalid"
                    );
                    assert_eq!(
                        request.headers().get("authorization").unwrap(),
                        "Bearer synthetic-valid"
                    );
                }
                response
            },
        )
        .with_state(count);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Upstream {
        origin,
        calls,
        task,
    }
}

#[tokio::test]
async fn preserves_status_bytes_challenges_and_original_credentials() {
    let body = "{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication is required\",\"details\":null,\"requestId\":\"synthetic\"}}";
    for status in [
        StatusCode::OK,
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::SERVICE_UNAVAILABLE,
    ] {
        let legacy = upstream(status, body).await;
        let app = CompatibilityEdge::new(&legacy.origin).unwrap().router();
        let request = Request::builder()
            .uri("/api/v1/projects?organization_id=org-a")
            .header("cookie", "__Host-ingenium_session=synthetic-invalid")
            .header("authorization", "Bearer synthetic-valid")
            .header("x-forwarded-user", "forged-admin")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(
            response.headers()["www-authenticate"],
            "Bearer realm=\"ingenium\""
        );
        assert_eq!(response.headers()["retry-after"], "19");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(
            to_bytes(response.into_body(), 4096).await.unwrap().as_ref(),
            body.as_bytes()
        );
        assert_eq!(legacy.calls.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn unknown_routes_writes_and_private_markers_never_contact_legacy() {
    let legacy = upstream(StatusCode::OK, "{\"data\":[]}").await;
    let app = CompatibilityEdge::new(&legacy.origin).unwrap().router();
    for (method, path, marker) in [
        ("POST", "/api/v1/projects", false),
        ("DELETE", "/api/v1/projects/archive", false),
        ("HEAD", "/api/v1/projects", false),
        ("GET", "/api/v1/auth/preflight", false),
        ("GET", "/api/v1/projects/", false),
        ("GET", "/api/v1/projects", true),
    ] {
        let mut request = Request::builder().method(method).uri(path);
        if marker {
            request = request.header("x-ingenium-internal-service", "1");
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    assert_eq!(legacy.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn redirects_fail_closed_without_replaying_credentials() {
    let legacy = upstream(StatusCode::FOUND, "{}").await;
    let response = CompatibilityEdge::new(&legacy.origin)
        .unwrap()
        .router()
        .oneshot(
            Request::builder()
                .uri("/api/v1/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(legacy.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn rejects_remote_credential_origins_and_url_components() {
    for origin in [
        "https://example.test",
        "http://localhost:4097",
        "http://127.0.0.1:4097/api",
        "http://user:secret@127.0.0.1:4097",
        "http://127.0.0.1:4097/?token=x",
        "http://127.0.0.1:4097/#fragment",
    ] {
        assert!(CompatibilityEdge::new(origin).is_err());
    }
    assert!(CompatibilityEdge::new("http://127.0.0.1:4097").is_ok());
}

#[tokio::test]
async fn disconnected_upstream_is_a_safe_gateway_failure() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut request_bytes = [0_u8; 4096];
        loop {
            socket.readable().await.unwrap();
            match socket.try_read(&mut request_bytes) {
                Ok(size) if size > 0 => break,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
                result => panic!("Expected a request before disconnect: {result:?}"),
            }
        }
        drop(socket);
    });
    let fixture = Upstream {
        origin,
        calls: Arc::new(AtomicUsize::new(0)),
        task,
    };
    let response = CompatibilityEdge::new(&fixture.origin)
        .unwrap()
        .router()
        .oneshot(
            Request::builder()
                .uri("/api/v1/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let error: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(error["error"]["code"], "UPSTREAM_UNAVAILABLE");
    assert_eq!(error["error"]["details"], serde_json::Value::Null);
    assert!(!String::from_utf8_lossy(&body).contains(&fixture.origin));
}

#[tokio::test]
async fn oversized_upstream_never_returns_partial_success() {
    let app = Router::new()
        .fallback(|| async { Response::new(Body::from(vec![b'x'; 4 * 1024 * 1024 + 1])) });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let fixture = Upstream {
        origin,
        calls: Arc::new(AtomicUsize::new(0)),
        task,
    };
    let response = CompatibilityEdge::new(&fixture.origin)
        .unwrap()
        .router()
        .oneshot(
            Request::builder()
                .uri("/api/v1/projects/archive")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let error: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(error["error"]["code"], "UPSTREAM_RESPONSE_TOO_LARGE");
    assert!(body.len() < 4096);
}

#[tokio::test]
async fn each_request_uses_its_own_credentials_and_drops_upstream_session_headers() {
    let app = Router::new().fallback(|request: Request<Body>| async move {
        let cookie = request.headers().get("cookie").unwrap().clone();
        let mut response = Response::new(Body::from(cookie.as_bytes().to_vec()));
        response.headers_mut().insert(
            "set-cookie",
            "synthetic-session=do-not-copy".parse().unwrap(),
        );
        response
            .headers_mut()
            .insert("x-private-diagnostic", "do-not-copy".parse().unwrap());
        response
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let fixture = Upstream {
        origin,
        calls: Arc::new(AtomicUsize::new(0)),
        task,
    };
    let edge = CompatibilityEdge::new(&fixture.origin).unwrap().router();
    for credential in [
        "__Host-ingenium_session=synthetic-a",
        "__Host-ingenium_session=synthetic-b",
    ] {
        let response = edge
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/projects")
                    .header("cookie", credential)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.headers().contains_key("set-cookie"));
        assert!(!response.headers().contains_key("x-private-diagnostic"));
        assert_eq!(
            to_bytes(response.into_body(), 4096).await.unwrap().as_ref(),
            credential.as_bytes()
        );
    }
}
