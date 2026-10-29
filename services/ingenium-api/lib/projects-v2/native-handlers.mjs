import {ProjectError,requireValue} from "../../../../packages/veyra-projects/domain.mjs";
import {immutableInput} from "./immutable-input.mjs";

export function createNativeExecutionHandlers({native,resolveScope,resolveContext}) {
  const run=operation=>async(req,res)=>{
    try {
      const body=immutableInput(req.body??{});
      const authorizedScope=await resolveScope(req);
      requireValue(authorizedScope,"UNAUTHENTICATED",401);
      const scope=immutableInput(authorizedScope);
      // The existing auth/runtime owner derives this context. Body scope/binding/owner fields grant nothing.
      const context=immutableInput(await resolveContext(req,scope));
      requireValue(Object.hasOwn(context,"projectId") && context.projectId!==undefined && context.binding);
      const input={scope,projectId:context.projectId,binding:context.binding};
      const result=await operation(input,body);
      res.status(result?.state==="unknown" || result?.state==="pending" ? 202 : 200).json({data:result});
    } catch(error) {
      const known=error instanceof ProjectError;
      res.status(known?error.status:500).json({error:{code:known?error.code:"INTERNAL_ERROR",
        message:known?error.code.replaceAll("_"," ").toLowerCase():"Native workspace operation failed"}});
    }
  };
  return {
    terminalDispatch:run((context,body)=>native.terminalDispatch({...context,
      action:body.action,args:body.args??{},operationId:body.operationId})),
    terminalReceipt:run((context,body)=>native.terminalReceipt({...context,
      action:body.action,args:body.args??{},operationId:body.operationId})),
    terminalRead:run((context,body)=>native.terminalRead({...context,terminalId:body.terminalId??null,after:body.after??0})),
    gitRead:run((context,body)=>native.reviewRead({...context,base:body.base??"",path:body.path??""})),
    gitPreview:run((context,body)=>native.previewReviewed({...context,domain:body.domain,selection:body.selection})),
    gitSubmit:run((context,body)=>native.submitReviewed({...context,domain:body.domain,original:body.original})),
    gitReceipt:run((context,body)=>native.reviewedReceipt({...context,domain:body.domain,original:body.original})),
  };
}
