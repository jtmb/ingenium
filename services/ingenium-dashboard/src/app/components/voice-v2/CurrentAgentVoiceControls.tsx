'use client';

import {useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import Image from 'next/image';
import {dashboardFetch,getApiBase} from '@/lib/api';
import type {VoiceMode} from '../../../../../../packages/veyra-voice/session.mjs';
import {CurrentAgentCallClient} from './current-agent-call-client.mjs';
import {CurrentCallTransport} from './current-call-transport.mjs';
import {VoiceControls} from './VoiceControls';
import {VoicePanel} from './VoicePanel';

export interface CurrentAgentVoiceControlsProps {
 workspaceId:string|null;runtimeId:string|null;engineSessionId:string|null;disabled?:boolean;active?:boolean;
 onDictation(text:string):void;onAdmitted():void;onResync?():void;
}
/** A scope-keyed caller mounts this. Rendering never opens a device, model or
 * call; the same canonical dashboard cookie/CSRF path handles every request. */
export function CurrentAgentVoiceControls(props:CurrentAgentVoiceControlsProps){
 const [client,setClient]=useState<CurrentAgentCallClient|null>(null),[expanded,setExpanded]=useState(false),[error,setError]=useState('');
 const current=useRef<CurrentAgentCallClient|null>(null),latest=useRef(props),hint=useId();
 useLayoutEffect(()=>{latest.current=props});
 useEffect(()=>()=>{const owned=current.current;if(owned)void owned.end().catch(()=>undefined);},[]);
 useEffect(()=>{if(client){if(props.active===false)setExpanded(false);void client.setPresentationActive(props.active!==false).catch(()=>undefined);}},[client,props.active]);
 const available=Boolean(props.workspaceId&&props.runtimeId&&props.engineSessionId&&!props.disabled&&props.active!==false);
 const start=(mode:VoiceMode)=>{
  if(current.current||!available||!props.workspaceId||!props.runtimeId||!props.engineSessionId)return;
  const transport=new CurrentCallTransport({request:dashboardFetch,basePath:getApiBase()+'/voice/current-calls'});
  const owned=new CurrentAgentCallClient({transport,selection:{workspaceId:props.workspaceId,runtimeId:props.runtimeId,engineSessionId:props.engineSessionId},mode,
   onDictation:text=>latest.current.onDictation(text),onAdmitted:()=>latest.current.onAdmitted(),onResync:()=>latest.current.onResync?.(),
   onEnded:()=>{if(current.current===owned){current.current=null;setClient(null);setExpanded(false);}}});
  current.current=owned;setClient(owned);setExpanded(true);setError('');void owned.start().catch(()=>setError('Voice could not be confirmed. Keep its original view available while you review or end it.'));
 };
 return <div aria-describedby={hint} className="inline-flex items-center gap-1">
  <span id={hint} className="sr-only">{available?'Dictate, call your current agent, or start a live conversation.':'Choose an existing conversation in a connected isolated workspace to use voice.'}</span>
  {client?<ActiveCurrentVoice client={client} expanded={expanded} setExpanded={setExpanded} onClose={()=>{if(current.current===client){current.current=null;setClient(null);setExpanded(false);}}}/>:<VoiceControls disabled={!available} onStart={start}/>}
  {error&&!client&&<span role="alert" className="text-xs text-red-200">{error}</span>}
 </div>;
}
function ActiveCurrentVoice({client,expanded,setExpanded,onClose}:{client:CurrentAgentCallClient;expanded:boolean;setExpanded(value:boolean):void;onClose():void}){
 const state=useSyncExternalStore(client.session.subscribe,client.session.getSnapshot,client.session.getSnapshot),dialog=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!expanded||!dialog.current)return;const original=document.activeElement instanceof HTMLElement?document.activeElement:null,node=dialog.current;
  const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(e=>!e.hasAttribute('disabled')&&!e.hidden&&e.tabIndex>=0);
  (focusable()[0]??node).focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);return;}if(event.key!=='Tab')return;const items=focusable(),first=items[0],last=items.at(-1);if(!first||!last){event.preventDefault();node.focus();return;}if(event.shiftKey&&(document.activeElement===first||!node.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus();}};
  node.addEventListener('keydown',key);return()=>{node.removeEventListener('keydown',key);if(original?.isConnected&&original!==document.body&&!node.contains(original)){original.focus();if(document.activeElement!==original)trigger.current?.focus();}else trigger.current?.focus();};
 },[expanded,setExpanded]);
 return <>
  <button ref={trigger} type="button" aria-label="Open active voice" aria-expanded={expanded} onClick={()=>setExpanded(true)} className="rounded-full bg-blue-600 px-3 py-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-blue-300">Voice · {state.phase==='ending'?'ending':state.muted?'mic off':'mic on'}</button>
  {createPortal(<div ref={dialog} hidden={!expanded} role="dialog" aria-modal={expanded?true:undefined} aria-label="Veyra voice" tabIndex={-1} className="fixed inset-0 z-[100] overflow-y-auto bg-[#0e0e0e] p-3 sm:p-8">
   <div className="mx-auto max-w-[900px]">
    <div className="flex justify-end"><button type="button" onClick={()=>setExpanded(false)} className="rounded-full px-3 py-2 text-xs text-neutral-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-300">Return to Work</button></div>
    <VoicePanel client={client} mascot={<Image src="/veyra-blue.png" alt="" width={48} height={48}/>} onClose={onClose}/>
   </div>
  </div>,document.body)}
 </>;
}