//! Pure source partitions under one existing Voice utterance. No operation
//! admission, model, conversation, scheduler, file or playback authority.
use super::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_CAPTURE_BYTES: usize = 60 * 16000 * 2;
pub const MAX_RECORD_BYTES: usize = 8 * 1024 * 1024;
pub fn digest(source: &[u8]) -> String { format!("{:x}", Sha256::digest(source)) }
#[derive(Clone, Serialize, Deserialize)]
pub struct SpeechChild {
    pub request_id: String,
    pub kind: String,
    pub index: usize,
    pub source_start: usize,
    pub source_end: usize,
    pub source_digest: String,
    pub digest: String,
    pub speech_digest: String,
    pub generation: u64,
    pub state: String,
    pub playback_id: Option<String>,
    pub playback_state: Option<String>,
    pub wav_digest: Option<String>,
}
impl SpeechChild {
    fn planned(kind: &str, index: usize, start: usize, end: usize, whole: &str, source: &[u8], spoken: &[u8]) -> Self {
        Self { request_id:uuid::Uuid::new_v4().to_string(),kind:kind.into(),index,
            source_start:start,source_end:end,source_digest:whole.into(),digest:digest(source),
            speech_digest:digest(spoken),generation:1,state:"planned".into(),
            playback_id:None,playback_state:None,wav_digest:None }
    }
}
pub fn pcm_children(pcm: &[u8]) -> Result<Vec<SpeechChild>> {
    if pcm.len() < 8000 || pcm.len() > MAX_CAPTURE_BYTES || pcm.len() % 2 != 0 { return Err(Error::Invalid); }
    let whole = digest(pcm);
    let mut ranges = Vec::new(); let mut offset = 0;
    while pcm.len()-offset > 480000 { ranges.push((offset,offset+480000)); offset += 480000; }
    if offset < pcm.len() {
        if pcm.len()-offset < 8000 {
            let previous = ranges.last_mut().ok_or(Error::Invalid)?;
            previous.1 -= 8000-(pcm.len()-offset); offset = previous.1;
        }
        ranges.push((offset,pcm.len()));
    }
    Ok(ranges.into_iter().enumerate().map(|(index,(start,end))|
        SpeechChild::planned("asr",index,start,end,&whole,&pcm[start..end],&pcm[start..end])).collect())
}
pub fn text_children(text: &str) -> Result<Vec<SpeechChild>> {
    if text.chars().count() > 32000 { return Err(Error::Invalid); }
    let whole = digest(text.as_bytes());
    let chars: Vec<(usize,char)> = text.char_indices().collect();
    let mut start = 0; let mut result = Vec::new();
    while start < chars.len() {
        let mut end = (start+160).min(chars.len());
        if end < chars.len() {
            for boundary in ((start.max(end.saturating_sub(16))+1)..=end).rev() {
                if chars[boundary-1].1.is_whitespace() || ".!?;:".contains(chars[boundary-1].1) { end=boundary;break; }
            }
        }
        let begin = chars[start].0;
        let stop = chars.get(end).map(|item| item.0).unwrap_or(text.len());
        let original = &text[begin..stop];
        // Preserve exact original source bytes. The worker cannot accept CR;
        // an explicit one-byte CR→LF speech projection keeps separate digests.
        let spoken = original.replace('\r', "\n");
        if !spoken.trim().is_empty() {
            if spoken.chars().any(|c| c < ' ' && c != '\n' && c != '\t') { return Err(Error::Invalid); }
            result.push(SpeechChild::planned("tts",result.len(),begin,stop,&whole,original.as_bytes(),spoken.as_bytes()));
        }
        start=end;
    }
    Ok(result)
}
pub fn child_wav(original: &[u8], child: &SpeechChild) -> Result<Vec<u8>> {
    if original.len() < 44 || child.kind != "asr" || child.source_start >= child.source_end
        || child.source_end > original.len()-44 || child.source_end-child.source_start > 480000
        || digest(&original[44..]) != child.source_digest { return Err(Error::Invalid); }
    let pcm = &original[44+child.source_start..44+child.source_end];
    if digest(pcm) != child.digest { return Err(Error::Conflict); }
    let mut wav = original[..44].to_vec(); wav.extend_from_slice(pcm);
    let length = (wav.len()-8) as u32;
    wav[4..8].copy_from_slice(&length.to_le_bytes()); wav[40..44].copy_from_slice(&(pcm.len() as u32).to_le_bytes());
    Ok(wav)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn tiny_tail_is_balanced_without_padding_or_lost_bytes() {
        let input=vec![7;480002];let children=pcm_children(&input).unwrap();
        assert_eq!(children.len(),2);assert_eq!(children[0].source_end,472002);
        assert_eq!(children[1].source_start,472002);assert_eq!(children[1].source_end,480002);
    }
    #[test] fn full_reply_offsets_preserve_unicode_and_cr_source() {
        let source=format!("{}\r\n{}","😀".repeat(601),"x".repeat(2001));let children=text_children(&source).unwrap();
        assert!(children.len()>4);assert_eq!(children.last().unwrap().source_end,source.len());
        for child in children { let part=&source[child.source_start..child.source_end];
            assert!(part.chars().count()<=160);assert_eq!(digest(part.as_bytes()),child.digest); }
    }
}
