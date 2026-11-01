"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '@/lib/api';
import type {RuntimeWorkspaceController,RuntimeWorkspaceOption} from '@/lib/use-runtime-launch';
import {createWorkspaceExecutionClient,createWorkspaceExecutionJournal,type ConfirmedWorkspaceExecution} from './workspace-execution-client.mjs';
import {createWorkspaceExecutionController,type WorkspaceExecutionState} from './workspace-execution-controller.mjs';
const initial:WorkspaceExecutionState={status:'loading',options:[],selectedWorkspaceId:null,confirmed:null,error:null};
export function useWorkspaceExecution(ownerUserId:string,organizationId:string|null,requestedRuntime:string|null){
 const scopeKey=JSON.stringify([ownerUserId,organizationId]);
 const [owned,setOwned]=useState<{scope:string;state:WorkspaceExecutionState}>({scope:'',state:initial});
 const owner=useRef<ReturnType<typeof createWorkspaceExecutionController>|null>(null);
 const routeRuntime=useRef(requestedRuntime),lastRequested=useRef(requestedRuntime);routeRuntime.current=requestedRuntime;
 const scopeState=owned.scope===scopeKey?owned.state:initial;
 const state=requestedRuntime && requestedRuntime!==scopeState.confirmed?.runtimeId && lastRequested.current!==requestedRuntime ? initial : scopeState;
 useEffect(()=>{
  const setState=(next:WorkspaceExecutionState)=>setOwned({scope:scopeKey,state:next});
  if(!organizationId){setState({...initial,status:'empty',error:'Choose an organization before selecting an execution target.'});return}
  lastRequested.current=routeRuntime.current;
  let controller:ReturnType<typeof createWorkspaceExecutionController>;
  try{
   const scope={ownerUserId,organizationId};
   controller=createWorkspaceExecutionController(createWorkspaceExecutionClient(request,scope),createWorkspaceExecutionJournal(window.sessionStorage,scope));
  }catch(error){setState({...initial,status:'error',error:error instanceof Error?error.message:'Execution selection is unavailable.'});return}
  owner.current=controller;setState(controller.getSnapshot());const unsubscribe=controller.subscribe(()=>setState(controller.getSnapshot()));void controller.load(routeRuntime.current);
  return()=>{unsubscribe();controller.close();if(owner.current===controller)owner.current=null};
 },[ownerUserId,organizationId]);
 useEffect(()=>{
  if(lastRequested.current===requestedRuntime)return;lastRequested.current=requestedRuntime;
  if(requestedRuntime && owner.current?.getSnapshot().confirmed?.runtimeId!==requestedRuntime)void owner.current?.load(requestedRuntime);
 },[requestedRuntime]);
 const selectWorkspace=useCallback((id:string)=>owner.current?.select(id),[]);
 const start=useCallback(async()=>{await owner.current?.start()},[]);
 const stop=useCallback(async()=>{await owner.current?.stop()},[]);
 const restart=useCallback(async()=>{await owner.current?.restart()},[]);
 const selected=state.options.find(row=>row.workspaceId===state.selectedWorkspaceId);
 const retry=useCallback(()=>{void owner.current?.load(requestedRuntime)},[requestedRuntime]);
 const workspace:RuntimeWorkspaceController={mode:'isolated',status:state.status,executionScope:state.confirmed??undefined,
  workspaces:state.options.map((row):RuntimeWorkspaceOption=>({id:row.workspaceId,organizationName:'Managed workspace',projectName:row.label,
   status:['READY','IDLE'].includes(row.claimedState)?'ready':['PROVISIONING','STARTING'].includes(row.claimedState)?'starting':['ABSENT','STOPPED','FAILED'].includes(row.claimedState)?'stopped':'unavailable',runtimeId:row.runtimeId})),
  selectedWorkspaceId:state.selectedWorkspaceId,confirmedWorkspaceId:state.confirmed?.workspaceId??null,confirmedRuntimeId:state.confirmed?.runtimeId??null,
  confirmedProjectName:null,error:state.error,selectWorkspace,start,retry,stop,restart,canStop:Boolean(selected&&['STARTING','READY','IDLE','STOPPING','FAILED'].includes(selected.claimedState)),canRestart:Boolean(selected&&['STOPPED','FAILED'].includes(selected.claimedState))};
 return {workspace,confirmed:state.confirmed as ConfirmedWorkspaceExecution|null};
}
