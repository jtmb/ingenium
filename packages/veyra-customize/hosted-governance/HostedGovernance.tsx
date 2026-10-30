import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {Binding,BoundGovernanceTransport,CatalogRow,ModelProvider,OperationReceipt,ProposalCounts,ProposalDetail,ProposalPage,Skill,SynthesisStatus,WriteCommand,WriteOriginal} from "./contracts";
import {bindingKey,createGovernanceClient,decodeSkill} from "./client";
import * as decode from "./decoders";
import {parseSkillUpload,runSkillSave,runSkillUpload,skillWriteBlocked,skillWriteFailure,verifySkillSave,verifySkillUpload,type SkillWriteResult} from "./skill-write-outcomes.mjs";
import {adaptSkillResult,normalizeOriginalRefusal} from "./writeOutcome";
import {proposalMatchesAction,receiptMatchesDraft,recoveredSaveResult,skillMatchesOriginal} from "./verification";
import "./hosted-governance.css";
export type HostedGovernanceProps={transport?:BoundGovernanceTransport;onOpenSkillInSession?:(skill:Skill,binding:Binding)=>void};
type Tab="skills"|"archived"|"proposals"|"synthesis";
const message=(e:unknown)=>skillWriteFailure(e).message;
const json=(v:unknown)=>JSON.stringify(v,null,2);
function MarkdownBody({text}:{text:string}) {return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children,href})=><span>{children}{href?" ("+href+")":""}</span>,img:({alt,src})=><span>External image: {alt} ({src}) — no remote media request was made.</span>}}>{text}</Markdown>;}
export function HostedGovernance({transport,onOpenSkillInSession}:HostedGovernanceProps) {
  const [tab,setTab]=useState<Tab>("skills"),[view,setView]=useState<"open"|"history">("open");
  let key:string;
  try{if(!transport||!Array.isArray(transport.capabilities)||!["current","read","reserve","send","inspect","pending"].every(name=>typeof (transport as unknown as Record<string,unknown>)[name]==="function"))throw new Error("No complete original transport.");key=bindingKey(transport.binding);}
  catch{return <section className="hg" role="status"><h2>Hosted governance unavailable</h2><p>An authenticated original transport and explicit actor/project/installation mapping are required.</p></section>;}
  return <GovernanceOwner key={key} transport={transport} onOpenSkillInSession={onOpenSkillInSession} tab={tab} setTab={setTab} view={view} setView={setView}/>;
}
function GovernanceOwner({transport,onOpenSkillInSession,tab,setTab,view,setView}:HostedGovernanceProps&{transport:BoundGovernanceTransport;tab:Tab;setTab:(tab:Tab)=>void;view:"open"|"history";setView:(view:"open"|"history")=>void}) {
  const alive=useRef(true),readEpoch=useRef(0),detailEpoch=useRef(0),proposalEpoch=useRef(0),pageEpoch=useRef(0),synthesisEpoch=useRef(0),writeLock=useRef(false),lastReceipt=useRef<OperationReceipt|null>(null),selectedId=useRef<string|null>(null),confirmButton=useRef<HTMLButtonElement>(null),confirmOrigin=useRef<HTMLElement|null>(null),statusRegion=useRef<HTMLDivElement>(null),skillHeading=useRef<HTMLHeadingElement>(null);
  const client=useMemo(()=>createGovernanceClient(transport,()=>alive.current),[transport]),b=client.binding;
  const [catalogLimit,setCatalogLimit]=useState(50),[archiveLimit,setArchiveLimit]=useState(50);
  const [query,setQuery]=useState(""),[rows,setRows]=useState<CatalogRow[]|null>(null),[archived,setArchived]=useState<Skill[]|null>(null);
  const [roots,setRoots]=useState<readonly WriteOriginal[]|null>(null),[receipt,setReceipt]=useState<OperationReceipt|null>(null),[barrier,setBarrier]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[catalogError,setCatalogError]=useState(""),[archiveError,setArchiveError]=useState(""),[originalError,setOriginalError]=useState("");
  const [skill,setSkill]=useState<Skill|null>(null),[file,setFile]=useState("SKILL.md"),[draft,setDraft]=useState(""),[editing,setEditing]=useState(false),[save,setSave]=useState<SkillWriteResult|null>(null);
  const [upload,setUpload]=useState(""),[uploadResult,setUploadResult]=useState<SkillWriteResult|null>(null),[pending,setPending]=useState<WriteCommand|null>(null);
  const [counts,setCounts]=useState<ProposalCounts|null>(null),[page,setPage]=useState<ProposalPage|null>(null),[proposalError,setProposalError]=useState(""),[detail,setDetail]=useState<ProposalDetail|null>(null);
  const [reviewer,setReviewer]=useState(b.actorId),[reason,setReason]=useState(""),[status,setStatus]=useState<SynthesisStatus|null>(null),[models,setModels]=useState<ModelProvider[]|null>(null),[model,setModel]=useState(""),[session,setSession]=useState(""),[events,setEvents]=useState<decode.PipelineEvent[]|null>(null),[synthesisError,setSynthesisError]=useState("");
  const blocked=busy||barrier||roots===null||roots.length>0||skillWriteBlocked(save)||skillWriteBlocked(uploadResult)||!client.current();
  const selectedModelKnown=!model||!!models?.some(p=>p.models.some(m=>json([p.providerId,m.id])===model));
  const can=(op:WriteCommand["op"])=>!blocked&&client.allowed(op);
  const current=()=>alive.current&&client.current();
  useEffect(()=>{setCatalogLimit(50);},[query]);
  useEffect(()=>{if(pending)confirmButton.current?.focus();},[pending]);
  useEffect(()=>{if(skill&&["skills","archived"].includes(tab))skillHeading.current?.focus();},[skill?.id,tab]);
  function requestConfirmation(command:WriteCommand){if(blocked||!client.allowed(command.op))return;confirmOrigin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPending(command);}
  function cancelConfirmation(){setPending(null);queueMicrotask(()=>{if(current())confirmOrigin.current?.isConnected?confirmOrigin.current.focus():statusRegion.current?.focus();});}
  const refreshOriginals=useCallback(async()=>{try{const value=await client.pending();if(current()){setRoots(value);setOriginalError("");}return value;}catch(e){if(current()){setRoots(null);setOriginalError(message(e));}throw e;}},[client]);
  const reload=useCallback(async()=>{
    const epoch=++readEpoch.current;let ok=true;
    const matches=()=>current()&&readEpoch.current===epoch;
    const results=await Promise.allSettled([client.catalog(),client.read({op:"archived"}),client.pending()]);
    if(!matches())return false;
    const [catalogResult,archivedResult,originals]=results;
    if(catalogResult.status==="fulfilled"){setRows(catalogResult.value);setCatalogError("");}else{ok=false;setRows(null);setCatalogError(message(catalogResult.reason));}
    if(archivedResult.status==="fulfilled"){try{const value=decode.data(archivedResult.value);if(!Array.isArray(value))throw new Error("Archived skill DTOs are unavailable.");const decoded=value.map(v=>decodeSkill(v,b));if(decoded.some(v=>!v.archived_at)||new Set(decoded.map(v=>v.id)).size!==decoded.length)throw new Error("Invalid archived identities.");setArchived(decoded);setArchiveError("");}catch(e){ok=false;setArchived(null);setArchiveError(message(e));}}
    else{ok=false;setArchived(null);setArchiveError(message(archivedResult.reason));}
    if(originals.status==="fulfilled"){setRoots(originals.value);setOriginalError("");}else{ok=false;setRoots(null);setOriginalError(message(originals.reason));}
    return ok;
  },[client]);
  useEffect(()=>{alive.current=true;void reload();return()=>{alive.current=false;readEpoch.current++;detailEpoch.current++;proposalEpoch.current++;pageEpoch.current++;synthesisEpoch.current++;};},[client,reload]);
  async function openSkill(name:string,expectedId?:string) {
    const epoch=++detailEpoch.current;setError("");selectedId.current=null;setSkill(null);setEditing(false);
    try{const value=await client.skill(name,expectedId);if(current()&&detailEpoch.current===epoch){selectedId.current=value.id;setSkill(value);setFile("SKILL.md");setDraft(value.content);}}
    catch(e){if(current()&&detailEpoch.current===epoch)setError(message(e));}
  }
  function filesOf(value:Skill):Record<string,string> {
    if(value.file_tree===null)return {};
    try{const map:unknown=JSON.parse(value.file_tree);if(!decode.record(map)||Object.values(map).some(v=>typeof v!=="string"))throw new Error();return map as Record<string,string>;}catch{return {};}
  }
  function changeFile(path:string){if(blocked||!skill)return;setFile(path);setDraft(path==="SKILL.md"?skill.content:filesOf(skill)[path]);setEditing(false);}
  async function write(command:WriteCommand):Promise<unknown> {
    const value=await client.mutate(command);if(current()){lastReceipt.current=value;setReceipt(value);setBarrier(value.outcome!=="refused");}
    if(value.outcome!=="succeeded")throw Object.assign(new Error(value.error?.message||"The original write outcome is unknown."),value.outcome==="refused"?{status:value.error?.status,code:value.error?.code,rootOutcome:"refused"}:{code:"UNKNOWN_WRITE"});
    return value.value;
  }
  async function serialize<T>(action:()=>Promise<T>):Promise<T|undefined> {
    if(writeLock.current)return;writeLock.current=true;setBusy(true);setError("");
    try{return await action();}catch(e){if(current())setError(message(e));return undefined;}
    finally{writeLock.current=false;if(current()){setBusy(false);void refreshOriginals().catch(()=>undefined);}}
  }
  function applySave(unchecked:SkillWriteResult){if(!current())return;const result=normalizeOriginalRefusal(unchecked);setSave(result);if(result.status==="verified"&&result.record){if(result.attempt&&selectedId.current===result.attempt.id){setSkill(result.record);setFile(result.attempt.path??"SKILL.md");setDraft(result.attempt?.text??result.record.content);setEditing(false);}if(receiptMatchesDraft(result,lastReceipt.current,"save"))setBarrier(false);}else if(skillWriteBlocked(result))setBarrier(true);}
  async function saveDraft() {
    if(!skill||!can("save"))return;
    await serialize(async()=>applySave(await runSkillSave(skill,file,draft,b.apiProject,{write:async(name,payload)=>write({op:"save",name,filePath:file,target:{id:skill.id,revision:skill.revision},content:payload.content,extra:payload.extra}),read:async name=>client.skill(name)})));
  }
  async function submitUpload() {
    if(!can("create")||rows===null||archived===null)return;
    const parsed=parseSkillUpload(upload);if(parsed&&(rows.some(row=>row.name===parsed.name)||archived.some(row=>row.name===parsed.name))){setUploadResult({status:"validation-error",writeConfirmed:false,message:"No upload was submitted. This name already exists; edit that exact record to preserve its identity, references and metadata."});return;}
    await serialize(async()=>{const raw=await runSkillUpload(upload,b.apiProject,{create:async value=>decodeSkill(decode.data(await write({op:"create",reviewedAbsent:true,...value})),b),refresh:reload});const result=adaptSkillResult(raw,lastReceipt.current);if(current()){setUploadResult(result);if(receiptMatchesDraft(result,lastReceipt.current,"upload"))setBarrier(skillWriteBlocked(result));}});
  }
  async function verifyDraft(which:"save"|"upload") {
    await serialize(async()=>{
      if(which==="save"&&save)applySave(await verifySkillSave(save,{read:async name=>client.skill(name)}));
      else if(which==="upload"&&uploadResult){const result=await verifySkillUpload(uploadResult,{read:async name=>client.skill(name),refresh:reload});if(current()){setUploadResult(result);if(receiptMatchesDraft(result,lastReceipt.current,"upload"))setBarrier(skillWriteBlocked(result));}}
    });
  }
  const loadProposals=useCallback(async(append=false,cursor?:string)=>{
    const epoch=++pageEpoch.current;setProposalError("");
    try{const [totals,result]=await Promise.all([client.read({op:"proposal-counts"}),client.read({op:"proposal-page",view,cursor})]);if(!current()||pageEpoch.current!==epoch)return;const next=decode.proposalPage(result);if(append&&next.pagination.hasMore&&next.pagination.nextCursor===cursor)throw new Error("Proposal pagination did not advance.");setCounts(decode.counts(totals));setPage(old=>({data:append&&old?[...old.data,...next.data.filter(row=>!old.data.some(v=>v.id===row.id))]:next.data,pagination:next.pagination}));}
    catch(e){if(current()&&pageEpoch.current===epoch){setProposalError(message(e));if(!append)setPage(null);}}
  },[client,view]);
  useEffect(()=>{if(tab==="proposals"){setPage(null);void loadProposals();}return()=>{pageEpoch.current++;};},[tab,view,loadProposals]);
  async function openProposal(id:string,enrich=true) {
    const epoch=++proposalEpoch.current;setDetail(null);setProposalError("");
    try{const value=decode.proposal(await client.read({op:"proposal",id,enrich}),b,id);if(current()&&proposalEpoch.current===epoch){setDetail(value);if(!enrich)setNotice("Basic proposal loaded without source enrichment. No denied read was retried.");}}
    catch(e){if(current()&&proposalEpoch.current===epoch)setProposalError(message(e));}
  }
  const loadSynthesis=useCallback(async()=>{
    const epoch=++synthesisEpoch.current;setSynthesisError("");
    const all=await Promise.allSettled([client.read({op:"synthesis-status"}),client.read({op:"synthesis-models"}),client.read({op:"pipeline"})]);
    if(!current()||synthesisEpoch.current!==epoch)return false;const messages:string[]=[];
    try{if(all[0].status==="rejected")throw all[0].reason;setStatus(decode.synthesisStatus(all[0].value));}catch(e){setStatus(null);messages.push(message(e));}
    try{if(all[1].status==="rejected")throw all[1].reason;setModels(decode.modelProviders(all[1].value));}catch(e){setModels(null);messages.push(message(e));}
    try{if(all[2].status==="rejected")throw all[2].reason;setEvents(decode.pipeline(all[2].value,b));}catch(e){setEvents(null);messages.push(message(e));}
    setSynthesisError(messages.join(" "));return messages.length===0;
  },[client]);
  useEffect(()=>{if(tab==="synthesis")void loadSynthesis();},[tab,loadSynthesis]);
  async function confirm() {
    if(!pending||blocked||!client.allowed(pending.op))return;const command=pending;setPending(null);queueMicrotask(()=>{if(current())statusRegion.current?.focus();});
    await serialize(async()=>{
      const response=await write(command);if(!current())return;
      let verified=false;
      if("name" in command){const actual=await client.skill(command.name,"target" in command?command.target.id:undefined);setSkill(actual);selectedId.current=actual.id;verified=skillMatchesOriginal(actual,command);}
      else if(command.op==="synthesis-run"){const acknowledgement=decode.data(response);if(!decode.record(acknowledgement)||acknowledgement.status!=="started")throw new Error("The original owner acknowledged the request, but its trigger response is unverified. Inspect the original; no run was replayed.");const actual=decode.synthesisStatus(await client.read({op:"synthesis-status"}));if(current())setStatus(actual);verified=true;setNotice("Synthesis trigger acknowledged. Batch completion, proposal approval, persisted activation and fresh-chat use still require their own evidence.");}
      else{const actual=decode.proposal(await client.read({op:"proposal",id:command.id}),b,command.id);setDetail(actual);verified=command.op==="approve"?actual.status==="applied":command.op==="reject"?actual.status==="rejected":["rolledBack","rolled_back"].includes(actual.status);}
      if(!current())return;if(!verified)throw new Error("Write acknowledged, but the current target differs from the requested state. No replay was sent.");
      if(!await reload())throw new Error("Write acknowledged, but catalog readback failed. Inspect the original before another write.");
      if(current()){setBarrier(false);if(command.op!=="synthesis-run")setNotice("Write acknowledged and current target read back.");if(tab==="proposals")void loadProposals();if(tab==="synthesis")void loadSynthesis();}
    });
  }
  async function inspect(original:WriteOriginal) {
    await serialize(async()=>{const actual=await client.inspect(original);if(current()){lastReceipt.current=actual;setUploadResult(previous=>previous?adaptSkillResult(previous,actual):previous);setReceipt(previous=>previous?.original.id===actual.original.id?{...actual,error:previous.error??actual.error}:actual);setNotice(actual.outcome==="unknown"?"Original remains unknown; it was not replayed.":"Original owner receipt: "+actual.outcome+". Read back the target before another change.");setBarrier(actual.outcome!=="refused");}await refreshOriginals();});
  }
  async function refreshAfterAcknowledgement() {
    await serialize(async()=>{
      if(!receipt||receipt.outcome!=="succeeded")throw new Error("The original owner must first confirm or refuse the write. A refresh alone is not a receipt.");
      const command=receipt.original.command;
      if("name" in command){const actual=await client.skill(command.name,"target" in command?command.target.id:undefined);if(!skillMatchesOriginal(actual,command))throw new Error("Target differs from the acknowledged payload; retained drafts and original remain available.");if(command.op==="save"&&current()){const recovered=recoveredSaveResult(receipt,actual);setSave(previous=>receiptMatchesDraft(previous,receipt,"save")?{...recovered,failure:previous?.failure}:recovered);}if(command.op==="create"&&uploadResult&&current())setUploadResult(adaptSkillResult({...uploadResult,status:"verified",record:actual},receipt));}
      else if(command.op==="synthesis-run"){const acknowledgement=decode.data(receipt.value);if(!decode.record(acknowledgement)||acknowledgement.status!=="started")throw new Error("A matching trigger acknowledgement is still required; status alone does not prove this original was accepted.");decode.synthesisStatus(await client.read({op:"synthesis-status"}));}
      else {const actual=decode.proposal(await client.read({op:"proposal",id:command.id}),b,command.id);if(!proposalMatchesAction(actual.status,command.op))throw new Error("The current proposal differs from the acknowledged action.");}
      if(await reload()&&current()){setBarrier(false);setNotice("Acknowledged original read back; no write was replayed.");}
    });
  }
  const visible=rows?.filter(row=>[row.name,row.description].some(v=>v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  function outcome(value:SkillWriteResult|null,which:"save"|"upload"){return value&&<div className="hg-outcome" role={value.status==="verified"?"status":"alert"} data-outcome={value.status}><p>{value.message}</p>{value.attempt?.text!==undefined&&<details><summary>Retained exact draft</summary><pre>{value.attempt.text}</pre></details>}{(skillWriteBlocked(value)||barrier&&receiptMatchesDraft(value,receipt,which))&&<button type="button" disabled={busy} onClick={()=>void verifyDraft(which)}>Verify stored {which}</button>}</div>;}
  return <section className="hg" aria-label="Hosted skill governance">
    <header><div><h1>Skills & governance</h1><p>{b.apiProject} · {b.visibility} · authenticated actor {b.actorId}</p></div><button type="button" disabled={busy} onClick={()=>void reload()}>Refresh authoritative metadata</button></header>
    <details><summary>Original authority details</summary><dl><dt>Hosted project</dt><dd>{b.hostedProjectId}</dd><dt>Installation</dt><dd>{b.installationId}</dd><dt>Grant revision</dt><dd>{b.grantRevision}</dd><dt>Native project</dt><dd>{b.nativeProjectId??"Explicitly projectless"}</dd></dl></details>
    <div ref={statusRegion} tabIndex={-1} aria-live="polite">{busy&&<p role="status">Processing the original operation or readback…</p>}</div>
    {!client.current()&&<p role="alert">Hosted authority changed. Return through the current authenticated owner; original writes remain retained.</p>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{originalError&&<p role="alert">{originalError}</p>}{outcome(uploadResult,"upload")}{(!skill||!["skills","archived"].includes(tab))&&outcome(save,"save")}
    {roots&&roots.length>0&&<section aria-label="Retained original operations"><h2>Original operations need recovery</h2>{roots.map(root=><div key={root.id}><p>{root.command.op} · {root.id}</p><button type="button" disabled={busy} onClick={()=>void inspect(root)}>Inspect original receipt</button></div>)}</section>}
    {receipt&&<details open={barrier}><summary>Last original: {receipt.outcome}</summary><p>{receipt.original.id} · {receipt.original.command.op}</p>{receipt.error&&<p>{receipt.error.message}</p>}<button type="button" disabled={busy} onClick={()=>void inspect(receipt.original)}>Inspect last original receipt</button><button type="button" disabled={busy||receipt.outcome!=="succeeded"} onClick={()=>void refreshAfterAcknowledgement()}>Read back acknowledged change</button></details>}
    <nav aria-label="Governance views">{(["skills","archived","proposals","synthesis"] as const).map(value=><button type="button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
    <div hidden={tab!=="skills"}>
      <h2>Installed skill metadata</h2>{catalogError&&<p role="alert">{catalogError}</p>}{rows===null&&!catalogError&&<p role="status">Loading full installed catalog…</p>}
      <label>Search skills<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {visible?.length===0&&<p>No matching installed records returned by this owner.</p>}
      <ul>{visible?.slice(0,catalogLimit).map(row=><li key={row.id}><button type="button" onClick={()=>{if(row.installed)void openSkill(row.name,row.id);else setNotice("Available catalog entry: "+row.name+". No installed source was opened; this owner has no configured catalog-install operation.");}}>{row.name} · {row.installed?"Installed":"Available"} · {row.installed?(row.enabled?"enabled":"disabled"):"not installed"} · revision {row.revision??"unavailable"}</button></li>)}</ul>
      {visible&&visible.length>catalogLimit&&<button type="button" onClick={()=>setCatalogLimit(value=>value+50)}>Show more installed metadata</button>}
      <details><summary>Upload a skill</summary><label>Review Markdown<textarea value={upload} onChange={e=>setUpload(e.target.value)} disabled={blocked}/></label>
        <label>Read Markdown file<input type="file" accept=".md" disabled={blocked} onChange={e=>{const file=e.target.files?.[0];if(file)void file.text().then(value=>{if(current())setUpload(value);}).catch(cause=>{if(current())setError("File could not be read. No upload submitted: "+message(cause));});}}/></label>
        <button type="button" disabled={!can("create")||rows===null||archived===null} onClick={()=>void submitUpload()}>Upload reviewed Markdown</button></details>
    </div>
    <div hidden={tab!=="archived"}><h2>Archived skills</h2>{archiveError&&<p role="alert">{archiveError}</p>}{archived===null&&!archiveError&&<p role="status">Loading archived records…</p>}<ul>{archived?.slice(0,archiveLimit).map(row=><li key={row.id}>{row.name} · revision {row.revision}<button type="button" onClick={()=>void openSkill(row.name,row.id)}>Review archived source</button><button type="button" disabled={!can("restore")} onClick={()=>requestConfirmation({op:"restore",name:row.name,target:{id:row.id,revision:row.revision}})}>Restore</button></li>)}</ul>{archived&&archived.length>archiveLimit&&<button type="button" onClick={()=>setArchiveLimit(value=>value+50)}>Show more archived records</button>}</div>
    {skill&&<section hidden={!["skills","archived"].includes(tab)} aria-label={"Hosted skill "+skill.name}><header><h2 ref={skillHeading} tabIndex={-1}>{skill.name}</h2><button type="button" onClick={()=>{selectedId.current=null;setSkill(null);detailEpoch.current++;}}>Close skill preview</button></header>
      <p>ID {skill.id} · revision {skill.revision} · {skill.archived_at?"archived":skill.enabled?"enabled":"disabled"} · always_apply {skill.always_apply}</p><p>{skill.description}</p>
      <label>Skill file<select value={file} disabled={busy||skillWriteBlocked(save)} onChange={e=>changeFile(e.target.value)}><option>SKILL.md</option>{Object.keys(filesOf(skill)).map(path=><option key={path}>{path}</option>)}</select></label>
      {editing?<label>Edit {file}<textarea aria-label={"Edit "+file} value={draft} disabled={busy||skillWriteBlocked(save)} onChange={e=>setDraft(e.target.value)}/></label>:<div className="hg-markdown"><MarkdownBody text={file==="SKILL.md"?skill.content:filesOf(skill)[file]||""}/></div>}
      {!editing?<button type="button" disabled={!can("save")||!!skill.archived_at} onClick={()=>{setDraft(file==="SKILL.md"?skill.content:filesOf(skill)[file]||"");setEditing(true);}}>Edit selected file</button>:<button type="button" disabled={!can("save")} onClick={()=>void saveDraft()}>Save exact draft</button>}
      {outcome(save,"save")}
      <button type="button" disabled={!can(skill.archived_at?"restore":"archive")} onClick={()=>requestConfirmation({op:skill.archived_at?"restore":"archive",name:skill.name,target:{id:skill.id,revision:skill.revision}})}>{skill.archived_at?"Restore skill":"Archive skill"}</button>
      <button type="button" disabled={!!skill.archived_at||!can(skill.enabled?"disable":"enable")} onClick={()=>requestConfirmation({op:skill.enabled?"disable":"enable",name:skill.name,target:{id:skill.id,revision:skill.revision}})}>{skill.enabled?"Disable skill":"Enable skill"}</button>
      <button type="button" disabled={!onOpenSkillInSession||!skill.enabled||!!skill.archived_at||blocked} onClick={()=>{if(current())onOpenSkillInSession?.(skill,b);}}>Open in session composer</button>
      {!onOpenSkillInSession&&<p>Native session selection is not connected. Persisted enablement does not prove fresh-chat activation.</p>}
    </section>}
    <div hidden={tab!=="proposals"}><h2>Grounded proposals</h2><div role="group" aria-label="Proposal status view">{(["open","history"] as const).map(value=><button type="button" key={value} aria-pressed={view===value} onClick={()=>{setView(value);setDetail(null);}}>{value==="open"?"Open":"History"}{counts?" ("+counts[value]+")":""}</button>)}<button type="button" onClick={()=>void loadProposals()}>Refresh proposals</button></div>
      {proposalError&&<p role="alert">{proposalError}</p>}<ul>{page?.data.map(row=><li key={row.id}><button type="button" onClick={()=>void openProposal(row.id)}>{row.targetName} · {row.proposalType} · {row.status}</button><button type="button" onClick={()=>void openProposal(row.id,false)}>Basic proposal details for {row.targetName}</button></li>)}</ul>{page?.pagination.hasMore&&<button type="button" onClick={()=>void loadProposals(true,page.pagination.nextCursor??undefined)}>Load more {view} proposals</button>}
      {detail&&<section aria-label={"Proposal "+detail.id}><h3>{detail.targetName} · {detail.status}</h3><p>Target ID {detail.targetSkillId??"new target"} · source project {detail.sourceProjectId??"none"} · source name {detail.sourceName??"none"}</p>{detail.proposalType==="merge"&&<p>Approving a merge updates the target and archives its source. Source administration permission and original source maintenance-lock ownership are required.</p>}<p>Expected revision {detail.expectedRevision??"new target"} · source revision {detail.expectedSourceRevision??"not provided"} · quality {detail.qualityScore} · novelty {detail.noveltyScore}</p>
        <div className="hg-comparison"><section><h4>Current target</h4><p>Observed revision {detail.currentSkill?.revision??"unavailable"}</p><pre>{detail.currentSkill?.content??"No current target source supplied."}</pre></section><section><h4>Proposed state</h4><pre>{json(detail.proposedState)}</pre></section>{detail.sourceSkill&&<section><h4>Merge source: {detail.sourceSkill.name}</h4><p>Source project {detail.sourceSkill.projectId} · observed revision {detail.sourceSkill.revision}</p><pre>{detail.sourceSkill.content}</pre></section>}</div>
        <details open><summary>Grounding evidence and observations</summary><pre>{json(detail.evidence)}</pre><pre>{json(detail.observations??detail.observationIds)}</pre></details>
        <button type="button" disabled={!client.allowed("skill")||!detail.targetSkillId} onClick={()=>{setTab("skills");void openSkill(detail.targetName,detail.targetSkillId??undefined);}}>Review target skill</button>
        <p>Review by {detail.reviewer??"not reviewed"} · {detail.reviewReason??"No review note"} · applied {detail.appliedAt??"not applied"}</p>
        <label>Reviewer audit label<input disabled={busy||!!pending} value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label><label>Review reason<textarea disabled={busy||!!pending} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        {(["approve","reject","rollback"] as const).map(op=><button type="button" key={op} disabled={!can(op)||!reviewer.trim()||(op==="rollback"?detail.status!=="applied":!["pending","draft"].includes(detail.status))||detail.proposalType==="merge"&&op!=="reject"&&!detail.sourceSkill} onClick={()=>requestConfirmation({op,id:detail.id,reviewed:{status:detail.status,updatedAt:detail.updatedAt,targetSkillId:detail.targetSkillId,sourceProjectId:detail.sourceProjectId,sourceName:detail.sourceName,expectedRevision:detail.expectedRevision,expectedSourceRevision:detail.expectedSourceRevision},reviewer,reason})}>{op==="approve"?"Approve & apply":op==="reject"?"Reject":"Roll back proposal"}</button>)}
      </section>}
    </div>
    <div hidden={tab!=="synthesis"}><h2>Synthesis & activation evidence</h2><p>A successful trigger is not a completed batch. Review grounded proposals, approve explicitly, read persisted enabled metadata and verify in a fresh session.</p><button type="button" onClick={()=>void loadSynthesis()}>Refresh batch and pipeline</button>{synthesisError&&<p role="alert">{synthesisError}</p>}
      {status&&<dl><dt>Pending observations</dt><dd>{status.pending_count}</dd><dt>Processed observations</dt><dd>{status.processed_count}</dd><dt>Last synthesis</dt><dd>{status.last_synthesis_at??"No completion recorded"}</dd><dt>Incomplete batch</dt><dd><pre>{status.incompleteBatch?json(status.incompleteBatch):"None reported"}</pre></dd></dl>}
      <label>Synthesis model<select value={model} onChange={e=>setModel(e.target.value)}><option value="">Existing server-owned selection</option>{model&&!selectedModelKnown&&<option value={model}>Previous choice unavailable — choose explicitly</option>}{models?.flatMap(p=>p.models.map(m=><option key={json([p.providerId,m.id])} value={json([p.providerId,m.id])}>{p.label} · {m.label}</option>))}</select></label><label>Optional source session<input value={session} onChange={e=>setSession(e.target.value)}/></label>
      <button type="button" disabled={!can("synthesis-run")||!status||!selectedModelKnown} onClick={()=>{const selection:string[]|null=model?JSON.parse(model):null;requestConfirmation({op:"synthesis-run",...(session?{sessionId:session}:{}),...(selection?{model:{providerId:selection[0],modelId:selection[1]}}:{})});}}>Review synthesis trigger</button>
      <p>Manual model choices require the existing signed-in runtime owner. No saved provider/model/default is changed.</p>
      <ol>{events?.map(event=><li key={event.id}><strong>{event.title}</strong> · {event.event_type} · {event.created_at}<p>{event.description}</p><details><summary>Recorded pipeline metadata</summary><pre>{json(event.data)}</pre></details></li>)}</ol>
    </div>
    {pending&&<form className="hg-confirm" aria-label="Confirm exact governance change" onSubmit={e=>{e.preventDefault();void confirm();}}><h2>Confirm {pending.op}</h2><p>Owner: {b.apiProject} · actor {b.actorId}</p><pre>{json(pending)}</pre><button ref={confirmButton} type="submit" disabled={blocked}>Confirm exact change</button><button type="button" disabled={busy} onClick={cancelConfirmation}>Cancel pending confirmation</button></form>}
  </section>;
}
