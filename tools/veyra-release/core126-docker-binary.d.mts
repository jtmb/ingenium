export interface ExchangeOptions {maxBytes?:number;timeoutMs?:number;signal?:AbortSignal;}
export interface BinaryResponse {status:number;headers?:Record<string,unknown>;bytes:Buffer;}
export interface OriginalBinaryIo {request(method:string,path:string,body?:Buffer|object,options?:ExchangeOptions):Promise<BinaryResponse>;hijack(path:string,body:object,input:Buffer,options?:ExchangeOptions):Promise<BinaryResponse>;}
/** Must be constructed inside the existing manager with its original socket/version closure. */
export function createOriginalDockerBinaryIo(input:{makeOriginalRequest:(options:object,callback:(response:any)=>void)=>any}):OriginalBinaryIo;
export function decodeDockerMultiplex(raw:Buffer,maxBytes?:number):{stdout:Buffer;stderr:Buffer};
export interface OriginalContainerBinding {containerId:string;imageId:string;daemonId:string;startedAt:string;publicProfileSha256:string;}
export interface OriginalRetirementFacts extends OriginalContainerBinding {waitSha256:string;inspectSha256:string;exitCode:number;finishedAt:string;}
export interface ProbeExecution {execId:string;containerId:string;exitCode:number;stdout:Buffer;stderr:Buffer;stdoutSha256:string;stderrSha256:string;rawFrameSha256:string;rawInspectSha256:string;probeSha256:string;}
declare const receipt:unique symbol;
export type OriginalRetirementReceipt=Readonly<{[receipt]:true}>;
export function originalContainerProfileSha256(container:any):string;
export function createCore126DockerProbeOwner(input:{io:OriginalBinaryIo;probeSource:Buffer;probeSha256:string;retainOriginalExec?:(actual:Readonly<{containerId:string;execId:string;probeSha256:string}>)=>void}):Readonly<{exec(containerId:string,input:unknown,options?:ExchangeOptions):Promise<ProbeExecution>;waitOriginalContainer(binding:OriginalContainerBinding,options?:ExchangeOptions):Promise<OriginalRetirementReceipt>;retirementFacts(receipt:OriginalRetirementReceipt):Readonly<OriginalRetirementFacts>;removeRetired(receipt:OriginalRetirementReceipt,options?:ExchangeOptions):Promise<{containerId:string;removed:true}>}>;
