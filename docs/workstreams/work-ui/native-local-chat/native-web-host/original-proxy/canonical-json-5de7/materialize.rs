pub fn materialize_resolved_web_files(original:&Payload,resolved:&crate::opencode::attachments::NativeWebFilesOriginal)->Result<EffectiveWebBody,String>{
    let view=crate::native_web_json::Json::parse(original.clone()).map_err(|_|invalid())?;
    let projection=resolved.journal_original(); // remaining provenance AST gate
    let canonical=view.canonical_sha256().map_err(|_|invalid())?;
    let alphabet=b"0123456789abcdef";let mut hex=[0;64];for(i,b)in canonical.iter().enumerate(){hex[2*i]=alphabet[(b>>4)as usize];hex[2*i+1]=alphabet[(b&15)as usize];}
    if projection.get("prompt_view_sha256").and_then(Value::as_str)!=Some(std::str::from_utf8(&hex).map_err(|_|invalid())?){return Err(invalid())}
    let files=view.member("files").map_err(|_|invalid())?;
    let mut replacements=Vec::new();
    for file in resolved.replacements(){
        let pointer=file.json_pointer();
        let index=pointer.strip_prefix("/files/").and_then(|p|p.strip_suffix("/uri")).and_then(|p|p.parse::<usize>().ok()).ok_or_else(invalid)?;
        let selected=files.as_ref().ok_or_else(invalid)?.item(index).map_err(|_|invalid())?.ok_or_else(invalid)?;
        let uri=selected.member("uri").map_err(|_|invalid())?.ok_or_else(invalid)?;
        if pointer!=format!("/files/{index}/uri")||!uri.string_eq(file.original_uri()).map_err(|_|invalid())?{return Err(invalid())}
        let (_,data)=file.effective_uri().split_once(',').ok_or_else(invalid)?;
        let mut decoded=original.pool().allocate(base64::decoded_len_estimate(data.len()).max(1)).map_err(|_|invalid())?;
        decoded.refill_dynamic(|out|STANDARD.decode_slice(data.as_bytes(),out)).map_err(|_|invalid())?;
        replacements.push(WebUriReplacement{file_index:index,original_uri_sha256:hash(file.original_uri().as_bytes()),captured_bytes_sha256:hash(decoded.as_ref()),effective_uri:file.effective_uri().into(),default_name:file.fallback_name().map(str::to_owned)});
    }
    materialize_web_uri_spans(original,&replacements)
}

pub fn materialize_web_uri_spans(original:&Payload,replacements:&[WebUriReplacement])->Result<EffectiveWebBody,String>{
    use crate::native_web_json::Json;
    if original.len()>16*1024*1024||replacements.len()>32{return Err(invalid())}
    let before=Json::parse(original.clone()).map_err(|_|invalid())?;
    if !before.canonical_is_object().map_err(|_|invalid())?{return Err(invalid())}
    before.canonical_sha256().map_err(|_|invalid())?; // same legacy full-Value validity
    let files=before.member("files").map_err(|_|invalid())?;
    let mut seen=BTreeSet::new();let mut edits:Vec<(Range<usize>,Payload)>=Vec::new();let mut transformations=Vec::new();
    let mut decoded_total=0usize;
    for replacement in replacements{
        if !seen.insert(replacement.file_index)||replacement.captured_bytes_sha256.len()!=64
            ||!replacement.captured_bytes_sha256.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())
            ||!replacement.effective_uri.starts_with("data:"){return Err(invalid())}
        let (header,data)=replacement.effective_uri.strip_prefix("data:").and_then(|s|s.split_once(',')).ok_or_else(invalid)?;
        let mime=header.strip_suffix(";base64").ok_or_else(invalid)?;
        if !["image/png","image/jpeg","image/webp","text/plain"].contains(&mime){return Err(invalid())}
        let mut captured=original.pool().allocate(base64::decoded_len_estimate(data.len()).max(1)).map_err(|_|invalid())?;
        captured.refill_dynamic(|out|STANDARD.decode_slice(data.as_bytes(),out)).map_err(|_|invalid())?;
        decoded_total=decoded_total.checked_add(captured.len()).ok_or_else(invalid)?;
        let mut encoded=original.pool().allocate(base64::encoded_len(captured.len(),true).ok_or_else(invalid)?.max(1)).map_err(|_|invalid())?;
        encoded.refill_dynamic(|out|STANDARD.encode_slice(captured.as_ref(),out)).map_err(|_|invalid())?;
        if encoded.as_ref()!=data.as_bytes()||hash(captured.as_ref())!=replacement.captured_bytes_sha256||decoded_total>8*1024*1024{return Err(invalid())}
        let (observed_mime,_)=crate::attachments::sniff_for_prompt(captured.as_ref()).map_err(|_|invalid())?;
        if observed_mime!=mime{return Err(invalid())}
        let file=files.as_ref().ok_or_else(invalid)?.item(replacement.file_index).map_err(|_|invalid())?.ok_or_else(invalid)?;
        let uri=file.member("uri").map_err(|_|invalid())?.ok_or_else(invalid)?;
        let span=uri.range_in(original).ok_or_else(invalid)?;
        let previous=uri.decoded_string_bounded(original.len()).map_err(|_|invalid())?;
        if hash(previous.as_ref())!=replacement.original_uri_sha256{return Err(invalid())}
        if let Some(name)=&replacement.default_name{
            if !previous.as_ref().starts_with(b"file://")||name.is_empty()||name.len()>4096||name.chars().any(char::is_control)
                ||file.member("name").map_err(|_|invalid())?.is_some(){return Err(invalid())}
            let file_range=file.range_in(original).ok_or_else(invalid)?;
            let end=file_range.end.checked_sub(1).filter(|n|original.get(*n)==Some(&b'}')).ok_or_else(invalid)?;
            let literal=json_payload(original.pool(),name).map_err(|_|invalid())?;
            let prefix=b",\"name\":"; // file has its original URI, so is nonempty
            let mut insertion=original.pool().allocate(prefix.len()+literal.len()).map_err(|_|invalid())?;
            insertion.append(prefix).map_err(|_|invalid())?;insertion.append(literal.as_ref()).map_err(|_|invalid())?;
            edits.push((end..end,insertion.freeze()));
        }
        let literal=json_payload(original.pool(),&replacement.effective_uri).map_err(|_|invalid())?;
        transformations.push(WebUriTransformation{file_index:replacement.file_index,
            original_uri_sha256:replacement.original_uri_sha256.clone(),original_literal_sha256:hash(&original[span.clone()]),
            captured_bytes_sha256:replacement.captured_bytes_sha256.clone(),effective_uri_sha256:hash(replacement.effective_uri.as_bytes()),default_name:replacement.default_name.clone()});
        if previous.as_ref()!=replacement.effective_uri.as_bytes(){edits.push((span,literal))}
    }
    edits.sort_by_key(|(span,_)|span.start);
    let capacity=edits.iter().try_fold(original.len(),|n,(span,literal)|n.checked_sub(span.len()).and_then(|n|n.checked_add(literal.len()))).ok_or_else(invalid)?;
    let mut effective=original.pool().allocate(capacity.max(1)).map_err(|_|invalid())?;let mut last=0;
    for(span,literal)in edits{
        if span.start<last{return Err(invalid())}
        effective.append(&original[last..span.start]).map_err(|_|invalid())?;effective.append(literal.as_ref()).map_err(|_|invalid())?;last=span.end;
        if effective.len()>16*1024*1024{return Err(invalid())}
    }
    effective.append(&original[last..]).map_err(|_|invalid())?;
    if effective.len()>16*1024*1024{return Err(invalid())}
    Json::parse(effective.share()).map_err(|_|invalid())?;
    Ok(EffectiveWebBody{original_body_sha256:hash(original),effective_body_sha256:hash(&effective),bytes:effective.freeze(),transformations})
}
