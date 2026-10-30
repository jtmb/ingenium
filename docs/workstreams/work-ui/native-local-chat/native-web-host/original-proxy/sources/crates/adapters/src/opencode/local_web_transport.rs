//! One original prompt HTTP send to the existing retained client endpoint.
//! This is not a generic method/path forwarding port or a second engine.
use super::*;
pub(crate) struct WebPromptResponse { pub status:u16,pub content_type:Option<String>,pub body:Vec<u8> }
impl OpenCodeClient {
    pub(crate) fn send_original_web_prompt_once(&self,session:&str,raw_target:&str,
        content_headers:&[(String,String)],effective_body:&[u8])->Result<WebPromptResponse,EngineError>{
        validate_session(session)?;
        let target=self.base.join(raw_target).map_err(|_|EngineError::InvalidEndpoint)?;
        let rendered=format!("{}{}",target.path(),target.query().map(|q|format!("?{q}")).unwrap_or_default());
        if target.origin()!=self.base.origin()||rendered!=raw_target
            ||target.path()!=format!("/api/session/{session}/prompt")||target.fragment().is_some()
            ||!target.username().is_empty()||target.password().is_some()||effective_body.len()>16*1024*1024
        {return Err(EngineError::Malformed);}
        // Actual cached reqwest0.12.28 declares retry::never and blocking
        // ClientBuilder::retry. No library retry, proxy discovery or redirects.
        let http=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never()).connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30)).build().map_err(|_|EngineError::Transport)?;
        let mut request=http.request(Method::POST,target);
        if let Some(auth)=&self.auth{request=request.basic_auth(&auth.username,Some(&auth.password));}
        let mut seen=std::collections::BTreeSet::new();
        for (name,value) in content_headers{
            if !["content-type","accept","content-encoding"].contains(&name.as_str())||!seen.insert(name)
                ||(name=="content-encoding"&&value!="identity")
                ||value.chars().any(char::is_control){return Err(EngineError::Malformed);}
            request=request.header(name.as_str(),value.as_str());
        }
        let response=request.body(effective_body.to_vec()).send().map_err(|_|EngineError::Transport)?;
        let status=response.status().as_u16();
        // No browser/upstream redirect response crosses this native boundary.
        if (300..400).contains(&status){return Err(EngineError::Transport);}
        let content_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|h|h.to_str().ok()).map(str::to_owned);
        let mut body=Vec::new();response.take(16*1024*1024+1).read_to_end(&mut body).map_err(|_|EngineError::Transport)?;
        if body.len()>16*1024*1024{return Err(EngineError::Malformed);}
        Ok(WebPromptResponse{status,content_type,body})
    }
}

#[cfg(test)]mod tests{
    use super::*;
    use std::{io::{BufRead,BufReader,Write},net::TcpListener,thread};
    fn fixture(status:&str)->(OpenCodeClient,thread::JoinHandle<(String,String,Vec<u8>)>){
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();
        let client=OpenCodeClient::new(&format!("http://{}",listener.local_addr().unwrap()),Some(EngineAuth::new("fixture".into(),"secret".into())),Duration::from_secs(2)).unwrap();
        let status=status.to_owned();let worker=thread::spawn(move||{
            let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut reader=BufReader::new(stream.try_clone().unwrap());let mut first=String::new();reader.read_line(&mut first).unwrap();
            let mut headers=String::new();let mut length=0;
            loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\r\n"{break;}
                if let Some(value)=line.to_ascii_lowercase().strip_prefix("content-length:"){length=value.trim().parse().unwrap();}headers.push_str(&line);}
            let mut body=vec![0;length];reader.read_exact(&mut body).unwrap();
            let reply="{}";write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nLocation: /api/session/ses_fixture/prompt?redirected=yes\r\nConnection: close\r\n\r\n{reply}",reply.len()).unwrap();
            stream.flush().unwrap();drop(stream);listener.set_nonblocking(true).unwrap();
            thread::sleep(Duration::from_millis(80));assert!(listener.accept().is_err(),"original request was repeated or redirected");
            (first,headers,body)
        });(client,worker)
    }
    #[test]fn full_effective_bytes_and_exact_target_are_sent_once_with_private_auth(){
        let (client,worker)=fixture("200 OK");let target="/api/session/ses_fixture/prompt?opaque=a%20b";
        let body=br#"{ "id":"msg_fixture", "files":[{"uri":"data:text/plain;base64,eA=="}],"metadata":{"future":true},"delivery":"queue","resume":false }"#;
        client.send_original_web_prompt_once("ses_fixture",target,&[("content-type".into(),"application/json".into())],body).unwrap();
        let (request,headers,received)=worker.join().unwrap();assert_eq!(request,format!("POST {target} HTTP/1.1\r\n"));assert_eq!(received,body);
        assert!(headers.to_ascii_lowercase().contains("authorization: basic zml4dhvyztpzzwnyzxq="));
        assert!(!request.contains("secret")&&!request.contains("fixture:"));
    }
    #[test]fn redirect_and_failure_responses_are_never_retried(){
        for status in ["302 Found","503 Service Unavailable"]{
            let (client,worker)=fixture(status);
            let result=client.send_original_web_prompt_once("ses_fixture","/api/session/ses_fixture/prompt",&[],b"{}");
            if status.starts_with("302"){assert!(result.is_err());}else{assert_eq!(result.unwrap().status,503);}
            worker.join().unwrap();
        }
    }
}
