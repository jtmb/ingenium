// @vitest-environment jsdom
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceChat } from "../workbench/VoiceChat";
import type { SpeechRequest } from "../workbench/VoiceWorkspace";

const sessionId="21af783b-b665-43b4-8482-c68606c1c166", turnId="65f38cd4-647a-4dfc-8366-cd3370e38813", childId="0b1c2d3e-4567-4890-abcd-123456789012";
const cpu={backend:"owned-http-cpu",available:true,transcription_configured:true,synthesis_configured:true,
  limits:{min_recording_ms:250,max_recording_ms:15000,max_text_chars:600,max_text_utf8_bytes:2400,max_output_ms:15000},voices:["af_sky"],configured_default_voice:"af_sky"};
const protocol={segmented_capture:true,max_utterance_seconds:60,playback_protocol:"voice-child-claim-v1"};
const owner={fixture:"original-owner"};
const node=()=>({connect:vi.fn(),disconnect:vi.fn()});
class Track { readyState="live";onended:(()=>void)|null=null;stop=vi.fn(()=>{this.readyState="ended";}); }
class Context {
  static all:Context[]=[];sampleRate=48000;destination={};source=node();gain={...node(),gain:{value:0}};
  processor={...node(),onaudioprocess:null as ((event:AudioProcessingEvent)=>void)|null};
  constructor(){Context.all.push(this);}resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
  createMediaStreamSource=()=>this.source;createScriptProcessor=()=>this.processor;createGain=()=>this.gain;
  frame(){const input=new Float32Array(2048).fill(.02);this.processor.onaudioprocess?.({inputBuffer:{sampleRate:48000,getChannelData:()=>input},outputBuffer:{getChannelData:()=>new Float32Array(2048)}} as unknown as AudioProcessingEvent);}
}
class Player {
  static all:Player[]=[];onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(_url:string){Player.all.push(this);}play=vi.fn(async()=>{});pause=vi.fn();
}
function setup(audio=false,permission?:Promise<unknown>) {
  const tracks:Track[]=[];const media=vi.fn(async()=>{if(permission)return permission;const track=new Track();tracks.push(track);return{getTracks:()=>[track],getAudioTracks:()=>[track]};});
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:media}});vi.stubGlobal("AudioContext",Context);vi.stubGlobal("Audio",Player);
  vi.stubGlobal("crypto",{subtle:webcrypto.subtle,randomUUID});
  const OriginalURL=URL;vi.stubGlobal("URL",class extends OriginalURL{static createObjectURL=vi.fn(()=>"blob:inert-audio");static revokeObjectURL=vi.fn();});
  const bytes=new Uint8Array(364), data=new DataView(bytes.buffer);
  for(const [offset,label] of [[0,"RIFF"],[8,"WAVE"],[12,"fmt "],[36,"data"]] as const) bytes.set(new TextEncoder().encode(label),offset);
  for(const [offset,value] of [[4,356],[16,16],[24,16000],[28,32000],[40,320]]) data.setUint32(offset,value,true);
  for(const [offset,value] of [[20,1],[22,1],[32,2],[34,16]]) data.setUint16(offset,value,true);
  const digest=createHash("sha256").update(bytes).digest("hex");
  const child={request_id:childId,kind:"tts",generation:1,state:"completed",playback_state:"ready",playback_id:null as string|null,wav_digest:digest};
  const originalReceipt={sessionId,utteranceId:turnId};localStorage.setItem("veyra.voice-chat.v1:project:working-chat",JSON.stringify(originalReceipt));
  let freshOwner:unknown=owner;
  const request=vi.fn<SpeechRequest>(async(method,path,body)=>{
    if(method==="GET"&&path==="/v1/speech/status")return cpu;
    if(method==="GET"&&path==="/v1/voice/status")return protocol;
    if(method==="GET"&&path==="/v1/voice/owner?session_id=working-chat")return freshOwner;
    const utterance={id:turnId,state:audio?"awaiting_playback":"awaiting_reply",transcript:"Original active prompt",children:audio?[{...child}]:[],speech_operation_id:audio?childId:null,wav_base64:audio?btoa(String.fromCharCode(...bytes)):null};
    if(method==="GET"&&path===`/v1/voice/sessions/${sessionId}`)return{id:sessionId,project_id:"project",session_id:"working-chat",state:audio?"speaking":"awaiting_reply",owner,voice:"af_sky",send_transcripts:true,read_replies:true,utterances:[utterance],active_utterance_id:turnId};
    if(method==="GET"&&path===`/v1/voice/sessions/${sessionId}/utterances/${turnId}`)return utterance;
    if(method==="POST"&&path===`/v1/voice/sessions/${sessionId}/utterances/${turnId}/playback`){
      const input=body as {claim_id:string;played:boolean};child.playback_id=input.claim_id;child.playback_state=input.played?"played":"claimed";return{...utterance,children:[{...child}]};
    }
    throw new Error(`Forbidden device-fixture effect ${method} ${path}`);
  });
  const props={request,projectId:"project",sessionId:"working-chat",connected:true,disabled:false,lease:{claim:()=>true,release:vi.fn()},isCurrent:()=>true,ownerMatches:()=>true};
  return{tracks,media,request,props,originalReceipt,setOwner:(next:unknown)=>{freshOwner=next;}};
}
beforeEach(()=>{localStorage.clear();Context.all=[];Player.all=[];});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
const enableMic=async()=>{const button=await screen.findByRole<HTMLButtonElement>("button",{name:"Unmute microphone"});await waitFor(()=>expect(button.disabled).toBe(false));fireEvent.click(button);await screen.findByRole("button",{name:"Mute microphone"});};
describe("local microphone control with inert devices and original active call",()=>{
  it("releases tracks/graph while keeping the original active agent and poll identity",async()=>{
    const f=setup();render(<VoiceChat {...f.props}/>);await enableMic();const before=localStorage.getItem("veyra.voice-chat.v1:project:working-chat");
    fireEvent.click(screen.getByRole("button",{name:"Mute microphone"}));await screen.findByRole("button",{name:"Unmute microphone"});
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);expect(Context.all[0].processor.onaudioprocess).toBeNull();expect(Context.all[0].processor.disconnect).toHaveBeenCalledTimes(1);expect(Context.all[0].close).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Thinking")).toBeTruthy();expect(localStorage.getItem("veyra.voice-chat.v1:project:working-chat")).toBe(before);
    fireEvent.click(screen.getByRole("button",{name:"Check original voice session and controls"}));await waitFor(()=>expect(f.request.mock.calls.filter(([,path])=>path===`/v1/voice/sessions/${sessionId}`).length).toBeGreaterThan(1));
    expect(f.request.mock.calls.some(([method])=>method==="POST")).toBe(false);
  });
  it("retains an entire unconfirmed frame, refuses implicit replay, and requires explicit discard before unmute",async()=>{
    const f=setup();render(<VoiceChat {...f.props}/>);await enableMic();Context.all[0].frame();
    fireEvent.click(screen.getByRole("button",{name:"Mute microphone"}));await screen.findByRole("button",{name:"Export complete unsubmitted capture"});
    expect(screen.getByRole<HTMLButtonElement>("button",{name:"Unmute microphone"}).disabled).toBe(true);expect(f.media).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button",{name:"Discard unsubmitted capture"}));await enableMic();expect(f.media).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls.some(([method])=>method==="POST")).toBe(false);expect(JSON.parse(localStorage.getItem("veyra.voice-chat.v1:project:working-chat")!)).toEqual(f.originalReceipt);
  });
  it("preserves the exact claimed played ACK through local mute and fresh unmute",async()=>{
    const f=setup(true);render(<VoiceChat {...f.props}/>);await enableMic();
    fireEvent.click(screen.getByRole("button",{name:"Check original voice session and controls"}));await waitFor(()=>expect(Player.all).toHaveLength(1));
    const claim=f.request.mock.calls.find(([method,,body])=>method==="POST"&&(body as {played?:boolean})?.played===false)![2] as {claim_id:string;generation:number;child_request_id:string};
    fireEvent.click(screen.getByRole("button",{name:"Mute microphone"}));await screen.findByRole("button",{name:"Unmute microphone"});expect(Player.all[0].pause).not.toHaveBeenCalled();
    await enableMic();Player.all[0].onended?.();
    await waitFor(()=>expect(f.request.mock.calls.some(([method,,body])=>method==="POST"&&(body as {played?:boolean})?.played===true)).toBe(true));
    const ack=f.request.mock.calls.find(([method,,body])=>method==="POST"&&(body as {played?:boolean})?.played===true)![2];expect(ack).toEqual({...claim,played:true});
    expect(f.request.mock.calls.filter(([method])=>method==="POST")).toHaveLength(2);expect(Player.all).toHaveLength(1);
  });
  it("does not reacquire after reconnect or owner change without explicit valid consent",async()=>{
    const f=setup();const view=render(<VoiceChat {...f.props}/>);await enableMic();fireEvent.click(screen.getByRole("button",{name:"Mute microphone"}));await screen.findByRole("button",{name:"Unmute microphone"});
    view.rerender(<VoiceChat {...f.props} connected={false}/>);view.rerender(<VoiceChat {...f.props}/>);await Promise.resolve();expect(f.media).toHaveBeenCalledTimes(1);
    f.setOwner({fixture:"changed-owner"});fireEvent.click(screen.getByRole("button",{name:"Unmute microphone"}));await screen.findByText(/original call owner or current configuration changed/);
    expect(f.media).toHaveBeenCalledTimes(1);expect(f.request.mock.calls.some(([method])=>method==="POST")).toBe(false);
  });
  it("cancels pending permission without ending or resubmitting the original call",async()=>{
    let resolve:(value:unknown)=>void=()=>{};const permission=new Promise<unknown>(yes=>{resolve=yes;});const f=setup(false,permission);render(<VoiceChat {...f.props}/>);
    const button=await screen.findByRole<HTMLButtonElement>("button",{name:"Unmute microphone"});await waitFor(()=>expect(button.disabled).toBe(false));fireEvent.click(button);
    await waitFor(()=>expect(f.media).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole("button",{name:"Cancel microphone request"}));const late=new Track();resolve({getTracks:()=>[late],getAudioTracks:()=>[late]});
    await waitFor(()=>expect(late.stop).toHaveBeenCalledTimes(1));expect(Context.all).toHaveLength(0);expect(f.request.mock.calls.some(([method])=>method==="POST")).toBe(false);
    expect(JSON.parse(localStorage.getItem("veyra.voice-chat.v1:project:working-chat")!)).toEqual(f.originalReceipt);
  });
});
