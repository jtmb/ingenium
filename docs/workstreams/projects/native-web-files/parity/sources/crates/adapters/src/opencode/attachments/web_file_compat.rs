//! Exact pinned pure materialization facts, NOT path/engine/model authority.
//! No active native bounds change. Root/Work1 own coordinated resource admission.
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum ProviderProjection{Text,Directory,Media,Ignored}
/// Byte detector from pinned Core Mime.detect. Includes the intentional
/// TextDecoder(fatal:true).decode(bytes,{stream:true}) incomplete-tail behavior.
pub fn pinned_detect_mime(bytes:&[u8])->&'static str{
 if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){return "image/png";}
 if bytes.starts_with(b"\xff\xd8\xff"){return "image/jpeg";}
 if bytes.starts_with(b"GIF8"){return "image/gif";}
 if bytes.starts_with(b"BM"){return "image/bmp";}
 if bytes.starts_with(b"%PDF-"){return "application/pdf";}
 if bytes.starts_with(b"RIFF")&&bytes.get(8..).is_some_and(|v|v.starts_with(b"WEBP")){return "image/webp";}
 if bytes.get(4..).is_some_and(|v|v.starts_with(b"ftyp"))&&bytes.get(8..).is_some_and(|v|v.starts_with(b"avif")||v.starts_with(b"avis")){return "image/avif";}
 if bytes.is_empty(){return "text/plain";}
 if bytes.contains(&0){return "application/octet-stream";}
 if std::str::from_utf8(bytes).is_err_and(|error|error.error_len().is_some()){return "application/octet-stream";}
 let controls=bytes.iter().filter(|b|**b<9||(**b>13&&**b<32)).count();
 // Avoid ratio rounding and integer multiplication overflow on arbitrary slices.
 if controls<=bytes.len()/10*3+(bytes.len()%10*3)/10{"text/plain"}else{"application/octet-stream"}
}
/// Source bytes remain distinct from UTF8 selected bytes. No range means the
/// original exact bytes, including an upstream-accepted incomplete UTF8 tail.
pub fn pinned_selected_bytes(bytes:&[u8],mime:&str,start:Option<u64>,end:Option<u64>)->Vec<u8>{
 let start=start.filter(|v|*v>0);let end=end.filter(|v|*v>0);
 if mime!="text/plain"||start.is_none(){return bytes.to_vec();}
 let start=start.unwrap_or(1).saturating_sub(1);
 String::from_utf8_lossy(bytes).split('\n').enumerate().filter(|(i,_)|(*i as u64)>=start&&end.is_none_or(|end|(*i as u64)<end)).map(|(_,line)|line).collect::<Vec<_>>().join("\n").into_bytes()
}
/// Applies AFTER upstream image normalization. BMP/AVIF/octet-stream have no
/// direct attachment projection in the pinned to-llm-message function.
pub fn pinned_provider_projection(mime:&str)->ProviderProjection{
 match mime{"text/plain"=>ProviderProjection::Text,"application/x-directory"=>ProviderProjection::Directory,
  "image/png"|"image/jpeg"|"image/gif"|"image/webp"|"application/pdf"=>ProviderProjection::Media,_=>ProviderProjection::Ignored}
}
pub const PINNED_FILE_BYTES:u64=20*1024*1024;
pub const PROPOSED_WIRE_BYTES:u64=32*1024*1024;
pub const ROOT_BLOB_AGGREGATE_BYTES:u64=64*1024*1024;
/// Checked resource arithmetic only. These numbers do not authorize allocation,
/// larger reads, activation or dispatch. Actual same-writer measured BLOB guards
/// and exact acknowledgment reservation belong to Root allocation7.
pub fn base64_bytes(bytes:u64)->Option<u64>{bytes.checked_add(2)?.checked_div(3)?.checked_mul(4)}
pub fn distinct_blob_bytes(lengths:&[u64])->Option<u64>{lengths.iter().try_fold(0u64,|total,n|total.checked_add(*n))}
#[cfg(test)]mod tests{
 use super::*;use base64::{Engine as _,engine::general_purpose::STANDARD};
 #[test]fn detector_matches_exact_pinned_oracle_vectors(){
  let vectors:serde_json::Value=serde_json::from_str(include_str!("web-file-compat-fixtures.json")).unwrap();
  for v in vectors["mime"].as_array().unwrap(){let bytes=STANDARD.decode(v["base64"].as_str().unwrap()).unwrap();assert_eq!(pinned_detect_mime(&bytes),v["mime"].as_str().unwrap(),"{}",v["name"]);}
 }
 #[test]fn selected_bytes_match_exact_pinned_buffer_slice(){
  let vectors:serde_json::Value=serde_json::from_str(include_str!("web-file-compat-fixtures.json")).unwrap();
  for v in vectors["selection"].as_array().unwrap(){let bytes=STANDARD.decode(v["base64"].as_str().unwrap()).unwrap();let actual=pinned_selected_bytes(&bytes,v["mime"].as_str().unwrap(),v["start"].as_u64(),v["end"].as_u64());assert_eq!(STANDARD.encode(actual),v["selectedBase64"].as_str().unwrap(),"{}",v["name"]);}
 }
 #[test]fn full_ack_changes_twenty_mib_admission_and_overflow_is_closed(){
  let wire=base64_bytes(PINNED_FILE_BYTES).unwrap();assert_eq!(wire,27_962_028);
  assert!(distinct_blob_bytes(&[PINNED_FILE_BYTES,wire,wire]).unwrap()>ROOT_BLOB_AGGREGATE_BYTES);
  assert!(base64_bytes(u64::MAX).is_none());assert!(distinct_blob_bytes(&[u64::MAX,1]).is_none());
 }
 #[test]fn directory_and_binary_projections_cannot_be_faked_by_data_mime(){
  assert_eq!(pinned_provider_projection("application/x-directory"),ProviderProjection::Directory);
  assert_eq!(pinned_provider_projection(pinned_detect_mime(b"a.txt\nsub/")),ProviderProjection::Text);
  assert_eq!(pinned_provider_projection("image/avif"),ProviderProjection::Ignored);
  assert_eq!(pinned_provider_projection("application/pdf"),ProviderProjection::Media);
 }
}
