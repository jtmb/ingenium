import { hostedSelection, hostedBinding, sameBinding, controllerBinding, validateInspection,
  policyReceipt, managementReceipt, integer } from './hosted-contract.mjs';
const error=(status,code)=>Object.assign(new Error('Hosted memory request unavailable'),{status,code});
/** Supply canonical dashboardFetch in production, never raw fetch/Authorization.
 * Requires Root's NEW work-binding route AND expected-binding header guards.
 * Missing endpoint => unavailable; no default binding or permission fallback. */
export function createHostedMemoryHttp({dashboardFetch,base}) {
  if(typeof dashboardFetch!=='function'||typeof base!=='string'||!base.startsWith('/')||base.startsWith('//')||/[?#\\]/.test(base))throw new TypeError('Canonical dashboard HTTP owner required');
  const root=base.replace(/\/$/,'')+'/memory/lifecycle', owned=new WeakSet();
  const query=(selection,extra={})=>new URLSearchParams({workspaceId:selection.workspaceId,runtimeId:selection.runtimeId,
    ...(typeof selection.projectId==='string'?{projectId:selection.projectId}:{}),
    ...(typeof selection.expectedProjectId==='string'?{expectedProjectId:selection.expectedProjectId}:{}),...extra});
  async function request(path,selection,{method='GET',body,extra={},binding,signal}={}) {
    const headers={Accept:'application/json'};
    if(binding)Object.assign(headers,{
      'X-Veyra-Memory-Scope':binding.scopeHash,'X-Veyra-Memory-Binding':binding.bindingHash,
      'X-Veyra-Memory-Epoch':String(binding.bindingEpoch),'X-Veyra-Memory-Context':binding.contextConversationId,
    });
    if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=body.operationId;}
    if(signal?.aborted)throw new DOMException('Original selection closed','AbortError');
    const response=await dashboardFetch(root+path+'?'+query(selection,extra),{
      method,headers,cache:'no-store',...(signal?{signal}:{}),
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    // No retry here: canonical fetch may repeat only a certified pre-handler
    // CSRF/step-up rejection. Errors after possible dispatch retain the journal.
    const raw=await response.text();
    if(raw.length>262144)throw new Error('Memory response limit exceeded');
    let value;try{value=JSON.parse(raw);}catch{throw new Error('Memory response outcome unknown');}
    if(!response.ok)throw error(response.status,typeof value?.error?.code==='string'?value.error.code:'UNKNOWN');
    return value;
  }
  async function loadBinding(input,signal) {
    const selected=hostedSelection(input);
    if(signal?.aborted)throw new DOMException('Original selection closed','AbortError');
    const result=await request('/work-binding',selected,{signal,extra:{engineSessionId:selected.engineSessionId}});
    if(signal?.aborted)throw new DOMException('Original selection closed','AbortError');
    const binding=hostedBinding(result?.data,selected);owned.add(binding);return binding;
  }
  function requireOwned(binding){if(!owned.has(binding))throw new Error('Binding was not acquired by this HTTP owner');}
  async function fresh(binding,permission='read',signal) {
    requireOwned(binding);const selected=hostedSelection({actorUserId:binding.actorUserId,organizationId:binding.organizationId,
      workspaceId:binding.workspaceId,runtimeId:binding.runtimeId,engineSessionId:binding.engineSessionId,expectedProjectId:binding.projectId});
    const current=await loadBinding(selected,signal);
    if(!sameBinding(current,binding))throw error(409,'BINDING_CHANGED');
    if(permission==='change'&&!current.canChange||permission==='forget'&&!current.canForget)throw error(403,'FORBIDDEN');
    return current;
  }
  function forBinding(binding,{signal}={}) {
    requireOwned(binding);const identity=controllerBinding(binding);
    const boundFresh=(permission='read')=>fresh(binding,permission,signal);
    const boundRequest=(path,options={})=>request(path,binding,{...options,binding,signal});
    const ui=value=>{if(JSON.stringify(value)!==JSON.stringify(identity))throw new Error('Different original memory selection');};
    const extra={chatId:binding.engineSessionId};
    return Object.freeze({
      controller:{
        async read(value){ui(value);const current=await boundFresh();
          const result=await boundRequest('/policy',{extra});const p=result?.data;
          if(!p||p.scopeHash!==binding.scopeHash||p.chatId!==binding.engineSessionId||p.bindingHash!==binding.bindingHash
            ||p.bindingEpoch!==binding.bindingEpoch||p.available!==true)throw new Error('Policy binding changed');
          return {...p,canChange:current.canChange};
        },
        async change(record){ui(record.identity);await boundFresh('change');
          const host=record.change.target==='host';
          if(!host&&record.change.target!=='chat')throw new TypeError('Invalid policy operation');
          const fields=host?['enabled','generate','useMemory','externalContext']:['useMemory','contribute'];
          const body={operationId:record.operationId,expectedRevision:record.change.expectedRevision,
            ...Object.fromEntries(fields.map(k=>[k,record.change.values[k]]))};
          const result=await boundRequest(host?'/policy':'/chats/'+encodeURIComponent(binding.engineSessionId)+'/policy',{method:'PUT',body,extra});
          return {receipt:policyReceipt(result?.data?.receipt,record)};
        },
        async operation(value,id){ui(value);await boundFresh();
          return (await boundRequest('/operations/'+encodeURIComponent(id),{extra}))?.data??null;
        },
      },
      async inspect(candidateOffset=0,limit=25){
        if(!integer(candidateOffset)||!integer(limit)||limit<1||limit>100||candidateOffset>Number.MAX_SAFE_INTEGER-limit)throw new TypeError('Invalid source cursor');
        await boundFresh();
        const result=await boundRequest('/entries',{extra:{...extra,candidateOffset:String(candidateOffset),limit:String(limit)}});
        await boundFresh();return validateInspection(result,candidateOffset,limit);
      },
      async previewReset(){await boundFresh('forget');const p=(await boundRequest('/reset-preview',{extra}))?.data;
        if(p?.scopeHash!==binding.scopeHash||!integer(p.count)||typeof p.confirmation!=='string'||!/^[a-f0-9]{64}$/.test(p.confirmation))throw new Error('Reset preview unavailable');
        return p;
      },
      async manage(record){
        if(record.scopeHash!==binding.scopeHash||!['forget','reset'].includes(record.action))throw new TypeError('Invalid management operation');
        await boundFresh('forget');const {scopeHash,origin,action,...body}=record;
        const result=await boundRequest('/'+action,{method:'POST',body,extra});
        return managementReceipt(result?.data?.receipt,record);
      },
      async managementOperation(record){await boundFresh();
        const result=await boundRequest('/operations/'+encodeURIComponent(record.operationId),{extra});
        return managementReceipt(result?.data,record);
      },
    });
  }
  return Object.freeze({loadBinding,forBinding});
}
