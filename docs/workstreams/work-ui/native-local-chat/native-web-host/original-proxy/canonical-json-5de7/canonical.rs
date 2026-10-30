//! Child of native_web_json. Exact library serialization over charged indexes.
use super::*;
use serde::{Serialize,Serializer,ser::{SerializeMap,SerializeSeq,Error as _}};
use std::{cmp::Ordering,fmt,io::{self,Write},sync::OnceLock};
struct Node<'a>{input:&'a[u8],pool:&'a std::sync::Arc<crate::native_web_payload::Pool>,legacy_embedded:bool}
struct Text<'a>(&'a[u8]);
impl fmt::Display for Text<'_>{fn fmt(&self,f:&mut fmt::Formatter<'_>)->fmt::Result{
 for c in Decoded::new(self.0).map_err(|_|fmt::Error)?{let mut encoded=[0;4];f.write_str(c.map_err(|_|fmt::Error)?.encode_utf8(&mut encoded))?}Ok(())
}}
impl Serialize for Text<'_>{fn serialize<S:Serializer>(&self,s:S)->Result<S::Ok,S::Error>{s.collect_str(self)}}
fn preserve_order()->bool{
 static ORDER:OnceLock<bool>=OnceLock::new();
 *ORDER.get_or_init(||{let mut m=serde_json::Map::new();m.insert("z".into(),serde_json::Value::Null);m.insert("a".into(),serde_json::Value::Null);m.keys().next().is_some_and(|key|key=="z")})
}
fn raw_value_feature()->bool{static FLAG:OnceLock<bool>=OnceLock::new();*FLAG.get_or_init(||serde_json::from_str::<serde_json::Value>(r#"{"$serde_json::private::RawValue":"null"}"#).is_ok_and(|v|v.is_null()))}
fn arbitrary_precision_feature()->bool{static FLAG:OnceLock<bool>=OnceLock::new();*FLAG.get_or_init(||serde_json::from_str::<serde_json::Value>(r#"{"$serde_json::private::Number":"1"}"#).is_ok_and(|v|v.is_number()))}
fn decode(pool:&std::sync::Arc<crate::native_web_payload::Pool>,literal:&[u8])->Result<Payload,Invalid>{
 let length=Decoded::new(literal)?.try_fold(0usize,|n,c|n.checked_add(c?.len_utf8()).ok_or(Invalid))?;
 let mut actual=pool.allocate(length.max(1)).map_err(|_|Invalid)?;for c in Decoded::new(literal)?{let mut bytes=[0;4];actual.append(c?.encode_utf8(&mut bytes).as_bytes()).map_err(|_|Invalid)?}Ok(actual.freeze())
}
// RawValue's embedded JSON is a separate legacy deserialization. Its duplicate
// keys use last-value semantics, and it has the library's127-container limit.
// Original literal objects were already checked by strict Json::parse.
fn legacy_value(scan:&mut Scan<'_>,containers:usize)->Result<(),Invalid>{
 scan.ws();match scan.byte()?{
  b'"'=>{scan.string()?;},b'-'|b'0'..=b'9'=>scan.number()?,b'n'=>scan.literal(b"null")?,b't'=>scan.literal(b"true")?,b'f'=>scan.literal(b"false")?,
  kind @ (b'['|b'{')=>{
   if containers>=127{return Err(Invalid)}scan.at+=1;scan.ws();let end=if kind==b'['{b']'}else{b'}'};if scan.peek()==Some(end){scan.at+=1;return Ok(())}
   loop{if kind==b'{'{scan.string()?;scan.expect(b':')?;}legacy_value(scan,containers+1)?;scan.ws();match scan.byte()?{b if b==end=>{scan.at+=1;break},b','=>scan.at+=1,_=>return Err(Invalid)}}
  },_=>return Err(Invalid)
 }Ok(())
}
fn skip(scan:&mut Scan<'_>,legacy:bool)->Result<(),Invalid>{if legacy{legacy_value(scan,0)}else{scan.value(1,false)}}
fn member_count(scan:&Scan<'_>,legacy:bool)->Result<usize,Invalid>{
 if !legacy{return scan.count_members(0)}let mut cursor=Scan{input:scan.input,at:scan.at,nodes:0,pool:scan.pool};let mut count=0usize;
 loop{count=count.checked_add(1).ok_or(Invalid)?;cursor.string()?;cursor.expect(b':')?;legacy_value(&mut cursor,0)?;cursor.ws();match cursor.byte()?{b'}'=>break,b','=>cursor.at+=1,_=>return Err(Invalid)}}Ok(count)
}
pub(super) fn is_object(json:&Json)->Result<bool,Invalid>{semantic_object(json.raw(),json.body.pool(),false)}
fn semantic_object(input:&[u8],pool:&std::sync::Arc<crate::native_web_payload::Pool>,legacy:bool)->Result<bool,Invalid>{
 let mut scan=Scan{input,at:0,nodes:0,pool};scan.ws();if scan.byte()?!=b'{'{return Ok(false)}scan.at+=1;scan.ws();if scan.peek()==Some(b'}'){return Ok(true)}
 let count=member_count(&scan,legacy)?;let first=scan.string()?;
 let raw=raw_value_feature()&&equals(&input[first.clone()],"$serde_json::private::RawValue")?;
 let number=arbitrary_precision_feature()&&equals(&input[first],"$serde_json::private::Number")?;
 if !raw&&!number{return Ok(true)}if count!=1{return Err(Invalid)}scan.expect(b':')?;scan.ws();let begin=scan.at;skip(&mut scan,legacy)?;
 let decoded=decode(pool,&input[begin..scan.at])?;
 if number{let text=std::str::from_utf8(decoded.as_ref()).map_err(|_|Invalid)?;let _:serde_json::Number=text.parse().map_err(|_|Invalid)?;return Ok(false)}
 let mut checked=Scan{input:decoded.as_ref(),at:0,nodes:0,pool};legacy_value(&mut checked,0)?;checked.ws();if checked.at!=decoded.len(){return Err(Invalid)}semantic_object(decoded.as_ref(),pool,true)
}
fn field(entry:&[u8],index:usize)->Result<usize,Invalid>{let raw:[u8;8]=entry.get(index*8..index*8+8).ok_or(Invalid)?.try_into().map_err(|_|Invalid)?;usize::try_from(u64::from_le_bytes(raw)).map_err(|_|Invalid)}
fn span(entry:&[u8],index:usize)->Result<Range<usize>,Invalid>{Ok(field(entry,index)?..field(entry,index+1)?)}
fn compare_keys(a:&[u8],b:&[u8])->Result<Ordering,Invalid>{
 let mut a=Decoded::new(a)?;let mut b=Decoded::new(b)?;
 loop{match(a.next(),b.next()){
  (Some(a),Some(b))=>{let order=a?.cmp(&b?);if order!=Ordering::Equal{return Ok(order)}},
  (None,None)=>return Ok(Ordering::Equal),(None,Some(_))=>return Ok(Ordering::Less),(Some(_),None)=>return Ok(Ordering::Greater),
 }}
}
impl Serialize for Node<'_>{
 fn serialize<S:Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
  let invalid=||S::Error::custom("Original canonical JSON unavailable");
  let mut scan=Scan{input:self.input,at:0,nodes:0,pool:self.pool};scan.ws();
  match scan.byte().map_err(|_|invalid())?{
   b'"'=>{let literal=scan.string().map_err(|_|invalid())?;Text(&self.input[literal]).serialize(serializer)},
   b'n'=>serializer.serialize_unit(),b't'=>serializer.serialize_bool(true),b'f'=>serializer.serialize_bool(false),
   b'-'|b'0'..=b'9'=>{
    // SAME serde_json Number parser/serializer as Value, including -0, u64/i64,
    // overflow-to-float, feature-selected precision and zmij finite formatting.
    // Resource bound requires actual target feature proof; see PLAN.md.
    let number:serde_json::Number=serde_json::from_slice(self.input).map_err(|_|invalid())?;
    number.serialize(serializer)
   },
   b'['=>{
    let mut seq=serializer.serialize_seq(None)?;scan.at+=1;scan.ws();
    if scan.peek()==Some(b']'){return seq.end()}
    loop{scan.ws();let start=scan.at;skip(&mut scan,self.legacy_embedded).map_err(|_|invalid())?;
     seq.serialize_element(&Node{input:&self.input[start..scan.at],pool:self.pool,legacy_embedded:self.legacy_embedded})?;
     scan.ws();match scan.byte().map_err(|_|invalid())?{b']'=>break,b','=>scan.at+=1,_=>return Err(invalid())}
    }seq.end()
   },
   b'{'=>{
    scan.at+=1;scan.ws();if scan.peek()==Some(b'}'){return serializer.serialize_map(Some(0))?.end()}
    let count=member_count(&scan,self.legacy_embedded).map_err(|_|invalid())?;
    let mut probe=Scan{input:self.input,at:scan.at,nodes:0,pool:self.pool};let first=probe.string().map_err(|_|invalid())?;
    let raw=raw_value_feature()&&equals(&self.input[first.clone()],"$serde_json::private::RawValue").map_err(|_|invalid())?;
    let number=arbitrary_precision_feature()&&equals(&self.input[first],"$serde_json::private::Number").map_err(|_|invalid())?;
    if raw||number{
     if count!=1{return Err(invalid())}probe.expect(b':').map_err(|_|invalid())?;probe.ws();let start=probe.at;skip(&mut probe,self.legacy_embedded).map_err(|_|invalid())?;
     let decoded=decode(self.pool,&self.input[start..probe.at]).map_err(|_|invalid())?;
     if number{let text=std::str::from_utf8(decoded.as_ref()).map_err(|_|invalid())?;let number:serde_json::Number=text.parse().map_err(|_|invalid())?;return number.serialize(serializer)}
     let mut validation=Scan{input:decoded.as_ref(),at:0,nodes:0,pool:self.pool};legacy_value(&mut validation,0).map_err(|_|invalid())?;validation.ws();if validation.at!=decoded.len(){return Err(invalid())}
     return Node{input:decoded.as_ref(),pool:self.pool,legacy_embedded:true}.serialize(serializer)
    }
    let capacity=count.checked_mul(32).ok_or_else(invalid)?;
    let mut entries=self.pool.allocate(capacity.max(1)).map_err(|_|invalid())?;
    let mut emitted=count;
    entries.refill_dynamic(|data|->Result<usize,Invalid>{
     for index in 0..count{
      let key=scan.string()?;scan.expect(b':')?;scan.ws();let start=scan.at;skip(&mut scan,self.legacy_embedded)?;
      for (part,value) in [key.start,key.end,start,scan.at].into_iter().enumerate(){let raw=u64::try_from(value).map_err(|_|Invalid)?.to_le_bytes();data[index*32+part*8..index*32+part*8+8].copy_from_slice(&raw)}
      scan.ws();match scan.byte()?{b'}' if index+1==count=>{},b',' if index+1<count=>scan.at+=1,_=>return Err(Invalid)}
     }
     if self.legacy_embedded{
      let mut distinct=0usize;
      for index in 0..count{let mut record=[0;32];record.copy_from_slice(&data[index*32..(index+1)*32]);let key=span(&record,0)?;let mut found=None;
       for prior in 0..distinct{let previous=span(&data[prior*32..(prior+1)*32],0)?;if compare_keys(&self.input[previous],&self.input[key.clone()])?==Ordering::Equal{found=Some(prior);break}}
       if let Some(prior)=found{data[prior*32+16..prior*32+32].copy_from_slice(&record[16..32]);}else{data[distinct*32..(distinct+1)*32].copy_from_slice(&record);distinct+=1;}
      }emitted=distinct;
     }
     if !preserve_order(){
      // Bounded in-place index sort; strings stay in the original allocation.
      // UTF8 byte lexicographic order equals decoded scalar order for valid str.
      for index in 1..emitted{let mut current=index;while current>0{
       let a=span(&data[(current-1)*32..current*32],0)?;let b=span(&data[current*32..(current+1)*32],0)?;
       if compare_keys(&self.input[a],&self.input[b])?!=Ordering::Greater{break}
       for byte in 0..32{data.swap((current-1)*32+byte,current*32+byte)}current-=1;
      }}
     }Ok(emitted*32)
    }).map_err(|_|invalid())?;
    let mut map=serializer.serialize_map(Some(emitted))?;
    for entry in entries.as_ref().chunks_exact(32){let key=span(entry,0).map_err(|_|invalid())?;let value=span(entry,2).map_err(|_|invalid())?;map.serialize_entry(&Text(&self.input[key]),&Node{input:&self.input[value],pool:self.pool,legacy_embedded:self.legacy_embedded})?}map.end()
   },_=>Err(invalid())
  }
 }
}
pub(super) fn hash(json:&Json)->Result<[u8;32],Invalid>{
 struct HashWriter(Sha256);impl Write for HashWriter{fn write(&mut self,bytes:&[u8])->io::Result<usize>{self.0.update(bytes);Ok(bytes.len())}fn flush(&mut self)->io::Result<()>{Ok(())}}
 let mut writer=HashWriter(Sha256::new());serde_json::to_writer(&mut writer,&Node{input:json.raw(),pool:json.body.pool(),legacy_embedded:false}).map_err(|_|Invalid)?;Ok(writer.0.finalize().into())
}

#[cfg(test)]mod tests{
 use super::*;
 fn charged(raw:&[u8])->Payload{let pool=crate::native_web_payload::Pool::for_registry();let mut b=pool.allocate(raw.len().max(1)).unwrap();b.append(raw).unwrap();b.freeze()}
 fn equivalent(raw:&[u8]){
  let legacy=serde_json::from_slice::<serde_json::Value>(raw);
  if legacy.is_err(){assert!(Json::parse(charged(raw)).and_then(|parsed|hash(&parsed)).is_err());return}
  let legacy=legacy.unwrap();let legacy_bytes=serde_json::to_vec(&legacy).unwrap();
  let parsed=Json::parse(charged(raw)).unwrap();assert_eq!(is_object(&parsed).unwrap(),legacy.is_object());let actual=serde_json::to_vec(&Node{input:parsed.raw(),pool:parsed.body.pool(),legacy_embedded:false}).unwrap();
  assert_eq!(actual,legacy_bytes);assert_eq!(hash(&parsed).unwrap().as_slice(),Sha256::digest(&legacy_bytes).as_slice());
 }
 #[test]fn exact_object_order_nested_unknowns_and_unicode_keys(){for raw in [br#"{"z":0,"a":{"d":4,"b":2},"future":[{"q":false,"a":null}]}"#.as_slice(),"{\"é\":1,\"a\":2,\"😀\":3,\"\\u0062\":4}".as_bytes()]{equivalent(raw)}}
 #[test]fn exact_string_escaping_surrogates_slashes_controls(){equivalent(br#"{"s":"\uD83D\uDE00\n\r\t\b\f\u0000\u001f\/\\\"\u00E9"}"#)}
 #[test]fn exact_integer_limits_negative_zero_exponent_and_float_rounding(){for raw in [b"-0".as_slice(),b"-0.0",b"18446744073709551615",b"18446744073709551616",b"-9223372036854775808",b"-9223372036854775809",b"1.00",b"1e+02",b"1e-308",b"5e-324",b"1.7976931348623157e308",b"0.123456789012345678901234567890123456789"]{equivalent(raw)}}
 #[test]fn exact_large_unknown_text_keeps_hash_and_releases_index_allocations(){let mut raw=b"{\"z\":\"".to_vec();raw.extend(std::iter::repeat_n(b'x',1024*1024));raw.extend_from_slice(b"\",\"a\":1}");let parsed=Json::parse(charged(&raw)).unwrap();let pool=parsed.body.pool().clone();let used=pool.used();let actual=hash(&parsed).unwrap();let legacy=serde_json::to_vec(&serde_json::from_slice::<serde_json::Value>(&raw).unwrap()).unwrap();assert_eq!(actual.as_slice(),Sha256::digest(&legacy).as_slice());assert_eq!(pool.used(),used);}
 #[test]fn duplicates_stay_refused_before_canonical_hash(){assert!(Json::parse(charged(br#"{"x":1,"\u0078":2}"#)).is_err())}
 #[test]fn exact_feature_selected_reserved_first_keys_and_failures(){for raw in [
  br#"{"$serde_json::private::RawValue":"null"}"#.as_slice(),
  br#"{"$serde_json::private::RawValue":"{\"z\":1,\"a\":2}"}"#,
  br#"{"\u0024serde_json::private::RawValue":"true"}"#,
  br#"{"z":0,"$serde_json::private::RawValue":"null"}"#,
  br#"{"$serde_json::private::RawValue":"null","z":0}"#,
  br#"{"$serde_json::private::RawValue":"{"}"#,
  br#"{"$serde_json::private::Number":"1e+02"}"#,
  br#"{"$serde_json::private::Number":1}"#,
  br#"{"z":0,"$serde_json::private::Number":"1e+02"}"#,
 ]{equivalent(raw)}}
 #[test]fn exact_embedded_raw_duplicate_and_depth_semantics(){
  equivalent(br#"{"$serde_json::private::RawValue":"{\"z\":0,\"a\":1,\"a\":2}"}"#);
  for depth in [126,127,128]{let inner=format!("{}0{}","[".repeat(depth),"]".repeat(depth));let literal=serde_json::to_string(&inner).unwrap();let raw=format!("{{\"$serde_json::private::RawValue\":{literal}}}");equivalent(raw.as_bytes())}
 }
}
