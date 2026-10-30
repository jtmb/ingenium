//! Pure native learned-memory domain. Existing GoalStore is the only persistence
//! owner; this crate opens no files, spawns no work and sends no prompts.
mod snapshot;
mod state;
mod types;
mod synthesis;
pub use snapshot::*;
pub use state::*;
pub use types::*;
pub use synthesis::*;
use sha2::{Digest,Sha256};
pub fn fingerprint<T:serde::Serialize>(value:&T)->Result<String,MemoryError>{
    let bytes=serde_json::to_vec(value).map_err(|_|MemoryError::Invalid)?;
    Ok(format!("{:x}",Sha256::digest(bytes)))
}
pub fn content_hash(value:&str)->String {format!("{:x}",Sha256::digest(value.as_bytes()))}
pub(crate) fn id(value:&str)->bool{!value.is_empty()&&value.len()<=512&&!value.chars().any(char::is_control)}
