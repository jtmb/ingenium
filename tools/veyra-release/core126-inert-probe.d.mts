/** Pure schema/inventory functions are CPU-testable; runNativeProbe executes only in the original candidate container. */
export function assertJsonSchema(value:unknown,schema:unknown,document:unknown,depth?:number):void;
export function nativeOperation(document:any,id:string):{path:string;method:string;op:any};
export function responseBytes(response:Response|any,limit?:number):Promise<Buffer>;
export function inertCatalog():object;
export function runNativeProbe(input:unknown):Promise<any>;
