// Local HTTP delivery only. This never owns/cancels an engine reader or agent.
const fault=code=>Object.assign(Error(code),{code});
export class CurrentCallConsumer {
 #queue=[];#bytes=0;#waiter=null;#pending=null;#closed=false;#failure=null;#controller=new AbortController();
 get signal(){return this.#controller.signal;}
 offer(frame){
  if(this.#closed)return;
  if(typeof frame!=='string'||Buffer.byteLength(frame)>16384||this.#queue.length>=32||this.#bytes+Buffer.byteLength(frame)>65536){this.#failure=fault('CALL_HTTP_EVENT_GAP');this.detach();return;}
  this.#queue.push(frame);this.#bytes+=Buffer.byteLength(frame);this.#wake();
 }
 #wake(){const done=this.#waiter;this.#waiter=null;done?.();}
 detach(){this.#closed=true;this.#queue=[];this.#bytes=0;this.#controller.abort(this.#failure);this.#wake();}
 next(signal){
  if(!(signal instanceof AbortSignal)||this.#pending)return Promise.reject(fault('CALL_HTTP_CONSUMER_CONFLICT'));
  const abort=()=>this.detach();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const original=Promise.resolve().then(async()=>{
   for(;;){if(this.#failure)throw this.#failure;if(this.#closed)return null;
    const frame=this.#queue.shift();if(frame!==undefined){this.#bytes-=Buffer.byteLength(frame);return frame;}
    await new Promise(resolve=>{this.#waiter=resolve;});
   }
  }).finally(()=>{signal.removeEventListener('abort',abort);if(this.#pending===original)this.#pending=null;});
  this.#pending=original;return original;
 }
 join(){return this.#pending??Promise.resolve();}
}
