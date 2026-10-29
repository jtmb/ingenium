use std::{env, error::Error, net::SocketAddr};
use veyra_api::CompatibilityEdge;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let listen: SocketAddr = env::var("VEYRA_API_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:4107".into())
        .parse()?;
    if !listen.ip().is_loopback() {
        return Err("Compatibility edge must bind loopback".into());
    }
    let origin =
        env::var("VEYRA_LEGACY_API_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:4097".into());
    let edge = CompatibilityEdge::new(&origin)?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    axum::serve(listener, edge.router()).await?;
    Ok(())
}
