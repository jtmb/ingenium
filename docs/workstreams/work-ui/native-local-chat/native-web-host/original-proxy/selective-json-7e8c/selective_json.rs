//! Validated spans into actual charged bytes. No serde Value/owned-string AST.
use crate::native_web_payload::{Payload,Buffer};
use sha2::{Digest,Sha256};
use std::ops::Range;
const DEPTH:usize=64;const NODES:usize=200_000;const KEYS:usize=4096;
#[derive(Debug,PartialEq,Eq)]pub(crate) struct Invalid;
pub(crate) struct Json{body:Payload}
impl Json{
 pub(crate) fn parse(body:Payload)->Result<Self,Invalid>{
  std::str::from_utf8(body.as_ref()).map_err(|_|Invalid)?;
  let mut scan=Scan{input:body.as_ref(),at:0,nodes:0,pool:body.pool()};scan.value(0,true)?;scan.ws();if scan.at!=body.len(){return Err(Invalid)}Ok(Self{body})
 }
 pub(crate) fn raw(&self)->&[u8]{self.body.as_ref()}
 pub(crate) fn is_object(&self)->bool{self.raw().iter().find(|b|!b.is_ascii_whitespace())==Some(&b'{')}
 pub(crate) fn is_number(&self)->bool{self.raw().iter().find(|b|!b.is_ascii_whitespace()).is_some_and(|b|*b==b'-'||b.is_ascii_digit())&&std::str::from_utf8(self.raw()).ok().and_then(|n|n.parse::<f64>().ok()).is_some_and(f64::is_finite)}
 pub(crate) fn boolean(&self)->Option<bool>{match self.raw().trim_ascii(){b"true"=>Some(true),b"false"=>Some(false),_=>None}}
 pub(crate) fn member(&self,name:&str)->Result<Option<Self>,Invalid>{
  let mut s=self.scanner();s.ws();if s.byte()?!=b'{'{return Ok(None)}s.at+=1;s.ws();if s.peek()==Some(b'}'){return Ok(None)}
  loop{let key=s.string()?;s.expect(b':')?;s.ws();let begin=s.at;s.value(1,false)?;let end=s.at;
   if equals(&self.raw()[key],name)?{return Ok(Some(Self{body:self.body.span(begin..end).ok_or(Invalid)?}))}
   s.ws();match s.byte()?{b'}'=>return Ok(None),b','=>s.at+=1,_=>return Err(Invalid)}
  }
 }
 pub(crate) fn item(&self,wanted:usize)->Result<Option<Self>,Invalid>{
  let mut s=self.scanner();s.ws();if s.byte()?!=b'['{return Ok(None)}s.at+=1;s.ws();if s.peek()==Some(b']'){return Ok(None)}
  let mut index=0usize;loop{s.ws();let begin=s.at;s.value(1,false)?;if index==wanted{return Ok(Some(Self{body:self.body.span(begin..s.at).ok_or(Invalid)?}))}
   index=index.checked_add(1).ok_or(Invalid)?;s.ws();match s.byte()?{b']'=>return Ok(None),b','=>s.at+=1,_=>return Err(Invalid)}
  }
 }
 pub(crate) fn string_eq(&self,expected:&str)->Result<bool,Invalid>{let mut s=self.scanner();let span=s.string()?;s.ws();if s.at!=self.body.len(){return Err(Invalid)}equals(&self.raw()[span],expected)}
 pub(crate) fn decoded_string(&self)->Result<Payload,Invalid>{self.decoded_string_bounded(usize::MAX)}
 pub(crate) fn decoded_string_bounded(&self,maximum:usize)->Result<Payload,Invalid>{
  let mut s=self.scanner();let span=s.string()?;s.ws();if s.at!=self.body.len(){return Err(Invalid)}let literal=&self.raw()[span];
  let length=Decoded::new(literal)?.try_fold(0usize,|n,c|n.checked_add(c?.len_utf8()).filter(|n|*n<=maximum).ok_or(Invalid))?;
  let mut out=self.body.pool().allocate(length.max(1)).map_err(|_|Invalid)?;
  for c in Decoded::new(literal)?{let mut encoded=[0;4];out.append(c?.encode_utf8(&mut encoded).as_bytes()).map_err(|_|Invalid)?}Ok(out.freeze())
 }
 fn scanner(&self)->Scan<'_>{Scan{input:self.raw(),at:0,nodes:0,pool:self.body.pool()}}
}
struct Scan<'a>{input:&'a[u8],at:usize,nodes:usize,pool:&'a std::sync::Arc<crate::native_web_payload::Pool>}
impl Scan<'_>{
 fn ws(&mut self){while self.peek().is_some_and(|b|matches!(b,b' '|b'\r'|b'\n'|b'\t')){self.at+=1}}
 fn peek(&self)->Option<u8>{self.input.get(self.at).copied()}
 fn byte(&self)->Result<u8,Invalid>{self.peek().ok_or(Invalid)}
 fn expect(&mut self,b:u8)->Result<(),Invalid>{self.ws();if self.byte()!=Ok(b){return Err(Invalid)}self.at+=1;Ok(())}
 fn string(&mut self)->Result<Range<usize>,Invalid>{
  self.ws();let start=self.at;if self.byte()?!=b'"'{return Err(Invalid)}self.at+=1;
  loop{match self.byte()?{b'"'=>{self.at+=1;break},b'\\'=>{self.at=self.at.checked_add(2).ok_or(Invalid)?;if self.at>self.input.len(){return Err(Invalid)}},_=>self.at+=1}}
  let span=start..self.at;for c in Decoded::new(&self.input[span.clone()])?{c?;}Ok(span)
 }
 fn number(&mut self)->Result<(),Invalid>{
  if self.peek()==Some(b'-'){self.at+=1}
  match self.byte()?{b'0'=>self.at+=1,b'1'..=b'9'=>{self.at+=1;while self.peek().is_some_and(|b|b.is_ascii_digit()){self.at+=1}},_=>return Err(Invalid)}
  if self.peek()==Some(b'.'){self.at+=1;let begin=self.at;while self.peek().is_some_and(|b|b.is_ascii_digit()){self.at+=1}if self.at==begin{return Err(Invalid)}}
  if self.peek().is_some_and(|b|matches!(b,b'e'|b'E')){self.at+=1;if self.peek().is_some_and(|b|matches!(b,b'+'|b'-')){self.at+=1}let begin=self.at;while self.peek().is_some_and(|b|b.is_ascii_digit()){self.at+=1}if self.at==begin{return Err(Invalid)}}Ok(())
 }
 fn value(&mut self,depth:usize,check:bool)->Result<(),Invalid>{
  if depth>DEPTH{return Err(Invalid)}if check{self.nodes=self.nodes.checked_add(1).filter(|n|*n<=NODES).ok_or(Invalid)?}self.ws();
  match self.byte()?{
   b'"'=>{self.string()?;},b'-'|b'0'..=b'9'=>self.number()?,
   b't'=>self.literal(b"true")?,b'f'=>self.literal(b"false")?,b'n'=>self.literal(b"null")?,
   b'['=>{self.at+=1;self.ws();if self.peek()==Some(b']'){self.at+=1;return Ok(())}loop{self.value(depth+1,check)?;self.ws();match self.byte()?{b']'=>{self.at+=1;break},b','=>self.at+=1,_=>return Err(Invalid)}}},
   b'{'=>{
    self.at+=1;self.ws();if self.peek()==Some(b'}'){self.at+=1;return Ok(())}
    let count=if check{self.count_members(depth)?}else{0};
    let mut keys:Option<Buffer>=if check{Some(self.pool.allocate(count.checked_mul(32).ok_or(Invalid)?.max(1)).map_err(|_|Invalid)?)}else{None};
    loop{let key=self.string()?;if let Some(keys)=keys.as_mut(){let mut hash=Sha256::new();for c in Decoded::new(&self.input[key])?{let mut encoded=[0;4];hash.update(c?.encode_utf8(&mut encoded).as_bytes())}let digest=hash.finalize();if keys.as_ref().chunks_exact(32).any(|prior|prior==&digest[..]){return Err(Invalid)}keys.append(&digest[..]).map_err(|_|Invalid)?;}
     self.expect(b':')?;self.value(depth+1,check)?;self.ws();match self.byte()?{b'}'=>{self.at+=1;break},b','=>self.at+=1,_=>return Err(Invalid)}
    }
   },_=>return Err(Invalid)
  }Ok(())
 }
 fn count_members(&self,depth:usize)->Result<usize,Invalid>{
  // Grammar-only prepass, no key storage/AST. Same existing4096/object bound.
  let mut s=Scan{input:self.input,at:self.at,nodes:0,pool:self.pool};let mut count=0usize;
  loop{count=count.checked_add(1).filter(|n|*n<=KEYS).ok_or(Invalid)?;s.string()?;s.expect(b':')?;s.value(depth+1,false)?;s.ws();match s.byte()?{b'}'=>break,b','=>s.at+=1,_=>return Err(Invalid)}}Ok(count)
 }
 fn literal(&mut self,b:&[u8])->Result<(),Invalid>{let end=self.at.checked_add(b.len()).ok_or(Invalid)?;if self.input.get(self.at..end)!=Some(b){return Err(Invalid)}self.at=end;Ok(())}
}
// The string iterator uses no heap. Input literal includes quotes. Surrogate pairs
// decode to exactly one scalar; invalid raw UTF8/controls/escapes are rejected.
struct Decoded<'a>{input:&'a[u8],at:usize,end:usize,failed:bool}
impl<'a> Decoded<'a>{
 fn new(input:&'a[u8])->Result<Self,Invalid>{if input.len()<2||input.first()!=Some(&b'"')||input.last()!=Some(&b'"'){return Err(Invalid)}Ok(Self{input,at:1,end:input.len()-1,failed:false})}
 fn hex(&mut self)->Result<u32,Invalid>{let mut n=0u32;for _ in 0..4{let b=*self.input.get(self.at).filter(|_|self.at<self.end).ok_or(Invalid)?;self.at+=1;let v=match b{b'0'..=b'9'=>b-b'0',b'a'..=b'f'=>b-b'a'+10,b'A'..=b'F'=>b-b'A'+10,_=>return Err(Invalid)};n=(n<<4)|u32::from(v)}Ok(n)}
 fn scalar(&mut self)->Result<char,Invalid>{
  let b=*self.input.get(self.at).filter(|_|self.at<self.end).ok_or(Invalid)?;self.at+=1;
  if b==b'\\'{let escaped=*self.input.get(self.at).filter(|_|self.at<self.end).ok_or(Invalid)?;self.at+=1;return match escaped{
   b'"'=>Ok('"'),b'\\'=>Ok('\\'),b'/'=>Ok('/'),b'b'=>Ok('\u{8}'),b'f'=>Ok('\u{c}'),b'n'=>Ok('\n'),b'r'=>Ok('\r'),b't'=>Ok('\t'),
   b'u'=>{let high=self.hex()?;let code=if(0xD800..=0xDBFF).contains(&high){if self.input.get(self.at..self.at+2)!=Some(b"\\u"){return Err(Invalid)}self.at+=2;let low=self.hex()?;if !(0xDC00..=0xDFFF).contains(&low){return Err(Invalid)}0x10000+((high-0xD800)<<10)+(low-0xDC00)}else{high};char::from_u32(code).ok_or(Invalid)},_=>Err(Invalid)
  }}
  if b<0x20||b==b'"'{return Err(Invalid)}if b<0x80{return Ok(char::from(b))}
  let size=match b{0xC2..=0xDF=>2,0xE0..=0xEF=>3,0xF0..=0xF4=>4,_=>return Err(Invalid)};
  let begin=self.at-1;let end=begin.checked_add(size).filter(|n|*n<=self.end).ok_or(Invalid)?;let text=std::str::from_utf8(&self.input[begin..end]).map_err(|_|Invalid)?;self.at=end;text.chars().next().ok_or(Invalid)
 }
}
impl Iterator for Decoded<'_>{type Item=Result<char,Invalid>;fn next(&mut self)->Option<Self::Item>{if self.failed||self.at==self.end{return None}let result=self.scalar();if result.is_err(){self.failed=true}Some(result)}}
fn equals(literal:&[u8],expected:&str)->Result<bool,Invalid>{let mut expected=expected.chars();for c in Decoded::new(literal)?{if Some(c?)!=expected.next(){return Ok(false)}}Ok(expected.next().is_none())}

#[cfg(test)]mod tests{
 use super::*;
 fn charged(raw:&[u8])->Payload{let p=crate::native_web_payload::Pool::for_registry();let mut b=p.allocate(raw.len().max(1)).unwrap();b.append(raw).unwrap();b.freeze()}
 #[test]fn unknown_metadata_remains_original_raw_spans(){let raw=br#"{ "id":"msg_a","metadata":{"huge":[true,null,1e+05,"x"]},"text":"\\n" }"#;let j=Json::parse(charged(raw)).unwrap();assert_eq!(j.raw(),raw);assert!(j.member("id").unwrap().unwrap().string_eq("msg_a").unwrap());assert_eq!(j.member("metadata").unwrap().unwrap().member("huge").unwrap().unwrap().item(2).unwrap().unwrap().raw(),b"1e+05");}
 #[test]fn duplicate_decoded_key_and_nested_duplicate_rejected(){for raw in [br#"{"id":1,"\u0069d":2}"#.as_slice(),br#"{"other":{"x":1,"x":2}}"#.as_slice()]{assert!(Json::parse(charged(raw)).is_err())}}
 #[test]fn escaped_surrogate_pair_decodes_into_charged_owner(){let j=Json::parse(charged(br#""\uD83D\uDE00\n""#)).unwrap();let decoded=j.decoded_string().unwrap();assert_eq!(decoded.as_ref(),"😀\n".as_bytes());drop(j);assert_eq!(decoded.len(),5);}
 #[test]fn malformed_number_utf8_surrogate_escape_and_trailing_data_rejected(){for raw in [b"01".as_slice(),b"1.",b"1e",b"true false",br#""\uD800""#,br#""\uDC00""#,br#""\x""#,b"\"\xff\""]{assert!(Json::parse(charged(raw)).is_err())}}
 #[test]fn ignored_large_string_does_not_become_an_owned_string(){let mut raw=b"{\"unknown\":\"".to_vec();raw.extend(std::iter::repeat_n(b'x',1024*1024));raw.extend_from_slice(b"\",\"id\":\"msg_a\"}");let body=charged(&raw);let p=body.pool().clone();let capacity=p.used();let j=Json::parse(body).unwrap();assert_eq!(p.used(),capacity);let id=j.member("id").unwrap().unwrap();assert!(id.string_eq("msg_a").unwrap());assert_eq!(p.used(),capacity);}
}
