fn classify(observed:&WebPromptObservation,session:&str,expected:Option<&str>)->(&'static str,Option<String>){
 if observed.phase!=WebTransportPhase::Complete{return("uncertain",None)}
 if observed.status.is_some_and(|s|matches!(s,400|401|403|404)){return("rejected",None)}
 if observed.status!=Some(200){return("uncertain",None)}
 let admitted=(||->Result<crate::native_web_payload::Payload,crate::native_web_json::Invalid>{
  use crate::native_web_json::{Json,Invalid};
  let value=Json::parse(observed.body.share())?;
  let user=value.member("data")?.ok_or(Invalid)?;
  let id=user.member("id")?.ok_or(Invalid)?.decoded_string_bounded(160)?;
  let id_text=std::str::from_utf8(id.as_ref()).map_err(|_|Invalid)?;
  if !id_text.starts_with("msg_")||id_text.len()<=4||!id_text.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')||expected.is_some_and(|v|v!=id_text){return Err(Invalid)}
  if !user.member("sessionID")?.ok_or(Invalid)?.string_eq(session)?
   ||!user.member("type")?.ok_or(Invalid)?.string_eq("user")?
   ||!user.member("time")?.ok_or(Invalid)?.member("created")?.ok_or(Invalid)?.is_number()
   ||!user.member("payload")?.ok_or(Invalid)?.is_object(){return Err(Invalid)}
  let delivery=user.member("delivery")?.ok_or(Invalid)?;
  if !delivery.string_eq("steer")?&&!delivery.string_eq("queue")?{return Err(Invalid)}
  Ok(id)
 })();
 match admitted{Ok(id)=>("admitted",Some(std::str::from_utf8(id.as_ref()).expect("validated original ID").to_owned())),Err(_)=>("uncertain",None)}
 // Bounded <=160-byte outcome ID metadata remains part of the explicit
 // bookkeeping budget; no large body/unknown metadata is copied into an AST.
 // This classification creates NO Windows materialization/read-join witness.
}
