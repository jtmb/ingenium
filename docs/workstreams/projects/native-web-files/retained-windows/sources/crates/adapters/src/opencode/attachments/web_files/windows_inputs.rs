//! Candidate parsing only; actual physical open/engine admission is separate.
use super::*;
pub(crate) struct WindowsInputs{pub(crate) absolute_files:Vec<String>,pub(crate) inline_image:bool,pub(crate) inline_bytes:usize}
#[cfg(windows)]
pub(crate) fn inspect_windows_inputs(prompt:&Value,directory:&str)->Result<WindowsInputs,String>{
 let object=prompt.as_object().ok_or_else(unavailable)?;let text=object.get("text").and_then(Value::as_str).ok_or_else(unavailable)?;
 let files=object.get("files").map(|v|v.as_array().ok_or_else(unavailable)).transpose()?;let files=files.map(Vec::as_slice).unwrap_or(&[]);
 if files.len()>MAX_PROMPT_ATTACHMENTS{return Err(unavailable());}
 let mut absolute_files=Vec::new();let mut inline_image=false;let mut inline_bytes=0usize;
 for file in files{
  mention(file,text)?;
  if file.get("name").is_some_and(|v|!v.as_str().is_some_and(valid_name))||file.get("description").is_some_and(|v|!v.is_string()){return Err(unavailable());}
  let uri=file.get("uri").and_then(Value::as_str).ok_or_else(unavailable)?;
  if uri.starts_with("data:"){
   let (_,bytes)=decode_data_uri(uri).ok_or_else(unavailable)?;let (mime,_)=crate::attachments::sniff_for_prompt(&bytes).map_err(|_|unavailable())?;
   inline_bytes=inline_bytes.checked_add(bytes.len()).filter(|n|*n<=MAX_PROMPT_BYTES).ok_or_else(unavailable)?;
   inline_image|=mime.starts_with("image/");
  }else{
   file_target(uri,directory,&LocalEnvironment::Windows)?;
   // Use the ORIGINAL URI path's case/spelling for actual handle traversal.
   // Never open a reconstructed canonical-root path then forward a differently
   // cased original under case-sensitive Windows directories.
   let path=reqwest::Url::parse(uri).map_err(|_|unavailable())?.to_file_path().map_err(|_|unavailable())?;
   absolute_files.push(path.to_str().ok_or_else(unavailable)?.to_owned());
  }
 }
 Ok(WindowsInputs{absolute_files,inline_image,inline_bytes})
}
#[cfg(not(windows))]
pub(crate) fn inspect_windows_inputs(_prompt:&Value,_directory:&str)->Result<WindowsInputs,String>{Err("Windows URI handle sharing requires Windows; WSL has no equivalent lease".into())}
