//! Lossless JSON data transformation only. This module grants no file authority.
//! Actual retained-handle materialization and current owner checks remain the
//! original resolver's responsibility; data supplied here is not a dispatch port.
use serde::{Serialize,Deserialize};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{collections::{BTreeMap,BTreeSet},ops::Range};
use base64::{Engine as _,engine::general_purpose::STANDARD};

#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebUriReplacement {
    pub file_index:usize,
    pub original_uri_sha256:String,
    pub captured_bytes_sha256:String,
    pub effective_uri:String,
    /// Actual captured basename only, when original file-branch name was absent.
    pub default_name:Option<String>,
}
#[derive(Clone,Serialize)]
pub struct WebUriTransformation {
    pub file_index:usize,
    pub original_uri_sha256:String,
    pub original_literal_sha256:String,
    pub captured_bytes_sha256:String,
    pub effective_uri_sha256:String,
    pub default_name:Option<String>,
}
/// Not Deserialize/Clone; constructed only by the verified lossless transform.
pub struct EffectiveWebBody {
    bytes:Vec<u8>,
    original_body_sha256:String,
    effective_body_sha256:String,
    transformations:Vec<WebUriTransformation>,
}
impl EffectiveWebBody {
    pub fn bytes(&self)->&[u8]{&self.bytes}
    pub fn original_body_sha256(&self)->&str{&self.original_body_sha256}
    pub fn effective_body_sha256(&self)->&str{&self.effective_body_sha256}
    pub fn transformations(&self)->&[WebUriTransformation]{&self.transformations}
}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn invalid()->String{"Original Web URI transformation is ambiguous or invalid".into()}

/// Only the actual retained resolver can construct this input proof. The
/// public replacement-data helper itself never grants filesystem authority.
pub fn materialize_resolved_web_files(original:&[u8],resolved:&crate::opencode::attachments::NativeWebFilesOriginal)->Result<EffectiveWebBody,String>{
    let view:Value=serde_json::from_slice(original).map_err(|_|invalid())?;
    let projection=resolved.journal_original();
    if projection.get("prompt_view_sha256").and_then(Value::as_str)!=Some(hash(&serde_json::to_vec(&view).map_err(|_|invalid())?).as_str()){return Err(invalid())}
    let mut replacements=Vec::new();
    for file in resolved.replacements(){
        let pointer=file.json_pointer();
        let index=pointer.strip_prefix("/files/").and_then(|p|p.strip_suffix("/uri")).and_then(|p|p.parse::<usize>().ok()).ok_or_else(invalid)?;
        if pointer!=format!("/files/{index}/uri")||view.pointer(pointer).and_then(Value::as_str)!=Some(file.original_uri()){return Err(invalid())}
        let (_,data)=file.effective_uri().split_once(',').ok_or_else(invalid)?;
        let bytes=STANDARD.decode(data).map_err(|_|invalid())?;
        replacements.push(WebUriReplacement{file_index:index,original_uri_sha256:hash(file.original_uri().as_bytes()),captured_bytes_sha256:hash(&bytes),effective_uri:file.effective_uri().into(),default_name:file.fallback_name().map(str::to_owned)});
    }
    materialize_web_uri_spans(original,&replacements)
}

#[derive(Clone,Copy)]
enum At { Root, Files, File(usize), Other }
struct Scanner<'a>{input:&'a[u8],offset:usize,nodes:usize,uris:BTreeMap<usize,Range<usize>>,file_ends:BTreeMap<usize,(usize,bool)>}
impl Scanner<'_>{
    fn ws(&mut self){while self.input.get(self.offset).is_some_and(|b|matches!(b,b' '|b'\n'|b'\r'|b'\t')){self.offset+=1;}}
    fn expect(&mut self,byte:u8)->Result<(),String>{self.ws();if self.input.get(self.offset)!=Some(&byte){return Err(invalid())}self.offset+=1;Ok(())}
    fn string(&mut self)->Result<Range<usize>,String>{
        self.ws();let start=self.offset;
        if self.input.get(start)!=Some(&b'"'){return Err(invalid())}self.offset+=1;
        loop{match self.input.get(self.offset){
            Some(b'"')=>{self.offset+=1;break},
            Some(b'\\')=>{self.offset+=2;if self.offset>self.input.len(){return Err(invalid())}},
            Some(_)=>self.offset+=1,None=>return Err(invalid())
        }}
        // serde validates UTF8, escape sequences, surrogate pairs and controls.
        serde_json::from_slice::<String>(&self.input[start..self.offset]).map_err(|_|invalid())?;
        Ok(start..self.offset)
    }
    fn value(&mut self,at:At,depth:usize)->Result<(),String>{
        self.nodes+=1;if depth>64||self.nodes>200_000{return Err(invalid())}self.ws();
        match self.input.get(self.offset){
            Some(b'{')=>{
                self.offset+=1;self.ws();if self.input.get(self.offset)==Some(&b'}'){
                    if let At::File(index)=at{self.file_ends.insert(index,(self.offset,false));}
                    self.offset+=1;return Ok(())}
                let mut keys=BTreeSet::new();
                loop{
                    let keyspan=self.string()?;let key:String=serde_json::from_slice(&self.input[keyspan]).map_err(|_|invalid())?;
                    if keys.len()>=4096||!keys.insert(key.clone()){return Err(invalid())}
                    self.expect(b':')?;self.ws();
                    if let At::File(index)=at {if key=="uri"{
                        let span=self.string()?;
                        if self.uris.insert(index,span).is_some(){return Err(invalid())}
                    }else{self.value(At::Other,depth+1)?;}}
                    else{self.value(if matches!(at,At::Root)&&key=="files"{At::Files}else{At::Other},depth+1)?;}
                    self.ws();match self.input.get(self.offset){Some(b',')=>self.offset+=1,Some(b'}')=>{
                        if let At::File(index)=at{self.file_ends.insert(index,(self.offset,true));}
                        self.offset+=1;break},_=>return Err(invalid())}
                }
            },
            Some(b'[')=>{
                self.offset+=1;self.ws();if self.input.get(self.offset)==Some(&b']'){self.offset+=1;return Ok(())}
                let mut index=0;
                loop{self.value(if matches!(at,At::Files){At::File(index)}else{At::Other},depth+1)?;index+=1;self.ws();
                    match self.input.get(self.offset){Some(b',')=>self.offset+=1,Some(b']')=>{self.offset+=1;break},_=>return Err(invalid())}}
            },
            Some(b'"')=>{self.string()?;},
            Some(_)=>{
                let start=self.offset;
                while self.input.get(self.offset).is_some_and(|b|!matches!(b,b','|b']'|b'}'|b' '|b'\n'|b'\r'|b'\t')){self.offset+=1;}
                if start==self.offset{return Err(invalid())}
            },None=>return Err(invalid())
        }Ok(())
    }
}

pub fn materialize_web_uri_spans(original:&[u8],replacements:&[WebUriReplacement])->Result<EffectiveWebBody,String>{
    if original.len()>16*1024*1024||replacements.len()>32{return Err(invalid())}
    let before:Value=serde_json::from_slice(original).map_err(|_|invalid())?;
    if !before.is_object(){return Err(invalid())}
    let mut scanner=Scanner{input:original,offset:0,nodes:0,uris:BTreeMap::new(),file_ends:BTreeMap::new()};
    scanner.value(At::Root,0)?;scanner.ws();if scanner.offset!=original.len(){return Err(invalid())}
    let mut expected=before.clone();let mut seen=BTreeSet::new();let mut edits=Vec::new();let mut transformations=Vec::new();
    let mut decoded_total=0usize;
    for replacement in replacements {
        if !seen.insert(replacement.file_index)||replacement.captured_bytes_sha256.len()!=64
            || !replacement.captured_bytes_sha256.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())
            || !replacement.effective_uri.starts_with("data:") {return Err(invalid())}
        let (header,data)=replacement.effective_uri.strip_prefix("data:").and_then(|s|s.split_once(',')).ok_or_else(invalid)?;
        let mime=header.strip_suffix(";base64").ok_or_else(invalid)?;
        if !["image/png","image/jpeg","image/webp","text/plain"].contains(&mime){return Err(invalid())}
        let captured=STANDARD.decode(data).map_err(|_|invalid())?;
        decoded_total=decoded_total.checked_add(captured.len()).ok_or_else(invalid)?;
        if STANDARD.encode(&captured)!=data||hash(&captured)!=replacement.captured_bytes_sha256||decoded_total>8*1024*1024{return Err(invalid())}
        let (observed_mime,_)=crate::attachments::sniff_for_prompt(&captured).map_err(|_|invalid())?;
        if observed_mime!=mime{return Err(invalid())}
        let span=scanner.uris.get(&replacement.file_index).ok_or_else(invalid)?.clone();
        let previous:String=serde_json::from_slice(&original[span.clone()]).map_err(|_|invalid())?;
        if hash(previous.as_bytes())!=replacement.original_uri_sha256{return Err(invalid())}
        let uri=expected.get_mut("files").and_then(Value::as_array_mut).and_then(|files|files.get_mut(replacement.file_index))
            .and_then(Value::as_object_mut).and_then(|file|file.get_mut("uri")).ok_or_else(invalid)?;
        if uri.as_str()!=Some(previous.as_str()){return Err(invalid())}
        *uri=Value::String(replacement.effective_uri.clone());
        if let Some(name)=&replacement.default_name {
            if !previous.starts_with("file://")||name.is_empty()||name.len()>4096||name.chars().any(char::is_control){return Err(invalid())}
            let file=expected.get_mut("files").and_then(Value::as_array_mut).and_then(|files|files.get_mut(replacement.file_index))
                .and_then(Value::as_object_mut).ok_or_else(invalid)?;
            if file.contains_key("name"){return Err(invalid())}
            file.insert("name".into(),Value::String(name.clone()));
            let (end,comma)=scanner.file_ends.get(&replacement.file_index).ok_or_else(invalid)?;
            let mut insertion=if *comma{b",\"name\":".to_vec()}else{b"\"name\":".to_vec()};
            insertion.extend_from_slice(&serde_json::to_vec(name).map_err(|_|invalid())?);
            edits.push((*end..*end,insertion));
        }
        let literal=serde_json::to_vec(&replacement.effective_uri).map_err(|_|invalid())?;
        transformations.push(WebUriTransformation{file_index:replacement.file_index,
            original_uri_sha256:replacement.original_uri_sha256.clone(),original_literal_sha256:hash(&original[span.clone()]),
            captured_bytes_sha256:replacement.captured_bytes_sha256.clone(),effective_uri_sha256:hash(replacement.effective_uri.as_bytes()),default_name:replacement.default_name.clone()});
        if previous!=replacement.effective_uri{edits.push((span,literal));}
    }
    edits.sort_by_key(|(span,_)|span.start);
    let mut effective=Vec::new();let mut last=0;
    for (span,literal) in edits {
        if span.start<last{return Err(invalid())}
        effective.extend_from_slice(&original[last..span.start]);effective.extend_from_slice(&literal);last=span.end;
        if effective.len()>16*1024*1024{return Err(invalid())}
    }
    effective.extend_from_slice(&original[last..]);
    if effective.len()>16*1024*1024||serde_json::from_slice::<Value>(&effective).map_err(|_|invalid())?!=expected{return Err(invalid())}
    Ok(EffectiveWebBody{original_body_sha256:hash(original),effective_body_sha256:hash(&effective),bytes:effective,transformations})
}

#[cfg(test)]mod tests{
    use super::*;
    fn replacement(uri:&str)->WebUriReplacement{WebUriReplacement{file_index:0,original_uri_sha256:hash(uri.as_bytes()),captured_bytes_sha256:hash(b"x"),effective_uri:"data:text/plain;base64,eA==".into(),default_name:None}}
    #[test]fn patches_only_original_uri_literal_and_preserves_unknown_fields_order_and_whitespace(){
        let raw=br#"{ "files" : [ { "unknown":1.00,"uri" : "file:///private/a?start=2&end=3", "mention":{"start":0,"end":2,"text":"@a"}} ], "parts":[{"future":true}],"metadata":{"comments":["retain"]},"delivery":"queue","resume":false }"#;
        let result=materialize_web_uri_spans(raw,&[replacement("file:///private/a?start=2&end=3")]).unwrap();
        let expected=String::from_utf8(raw.to_vec()).unwrap().replace("\"file:///private/a?start=2&end=3\"","\"data:text/plain;base64,eA==\"");
        assert_eq!(result.bytes(),expected.as_bytes());assert_ne!(result.original_body_sha256(),result.effective_body_sha256());
    }
    #[test]fn duplicate_keys_anywhere_or_wrong_original_hash_are_refused(){
        for raw in [br#"{"files":[{"uri":"a","uri":"b"}]}"#.as_slice(),br#"{"files":[],"files":[]}"#.as_slice(),br#"{"metadata":{"x":1,"x":2}}"#.as_slice()]{assert!(materialize_web_uri_spans(raw,&[]).is_err());}
        assert!(materialize_web_uri_spans(br#"{"files":[{"uri":"file:///wrong"}]}"#,&[replacement("file:///original")]).is_err());
    }
    #[test]fn no_transform_is_byte_exact_and_duplicate_indexes_are_refused(){
        let raw=br#"{ "files":[], "unicode":"\uD83D\uDE00", "n":1e+02 }"#;
        assert_eq!(materialize_web_uri_spans(raw,&[]).unwrap().bytes(),raw);
        let raw=br#"{"files":[{"uri":"file:///a"}]}"#;
        assert!(materialize_web_uri_spans(raw,&[replacement("file:///a"),replacement("file:///a")]).is_err());
    }
    #[test]fn basename_default_is_only_inserted_when_original_file_name_is_absent(){
        let raw=br#"{"files":[{"uri":"file:///private/a", "mention":{"text":"@a"}}],"future":true}"#;
        let mut change=replacement("file:///private/a");change.default_name=Some("a".into());
        let result=materialize_web_uri_spans(raw,&[change.clone()]).unwrap();
        let parsed:Value=serde_json::from_slice(result.bytes()).unwrap();assert_eq!(parsed["files"][0]["name"],"a");
        assert!(materialize_web_uri_spans(br#"{"files":[{"uri":"file:///private/a","name":"original"}]}"#,&[change]).is_err());
    }
}
