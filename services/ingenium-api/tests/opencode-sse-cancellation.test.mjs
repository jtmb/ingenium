import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
const source=readFileSync(new URL('../lib/opencode-client.ts',import.meta.url),'utf8');
const start=source.indexOf('async function streamRequest('),end=source.indexOf('\n/**\n * Helper: check',start);
assert.ok(start>=0&&end>start,'Actual SSE transport source boundary');
const transport=stripTypeScriptTypes(source.slice(start,end));
const makeTransport=new Function('currentOpenCodeRuntimeTarget','buildAuthHeader','config',transport+';return streamRequest;');
// Actual fetch + loopback HTTP exercise the installed transport. Runtime/auth
// target is an explicit fixture; these cases do not establish agent settlement.
async function withServer(handler,run){
 const sockets=new Set(),server=createServer(handler);server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const baseUrl='http://127.0.0.1:'+server.address().port;
 const stream=makeTransport(()=>({baseUrl,authHeader:'Bearer finite-fixture'}),()=>{throw Error('No ambient auth');},{});
 try{return await run(stream);}finally{server.closeAllConnections();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned transport did not close')),3000);})]);}finally{clearTimeout(timer);}}
test('pre-aborted signal opens no HTTP request',async()=>{let requests=0;await withServer((_req,res)=>{requests++;res.end();},async stream=>{const abort=new AbortController();abort.abort();const result=await stream('/api/event',undefined,undefined,abort.signal);assert.equal(result.error.code,'NETWORK_ERROR');assert.equal(requests,0);});});
test('abort before SSE response headers closes the original pending request',async()=>{const entered=deferred(),closed=deferred();await withServer((req,_res)=>{req.once('close',closed.resolve);entered.resolve();},async stream=>{const abort=new AbortController(),pending=stream('/api/event',undefined,undefined,abort.signal);await bounded(entered.promise);abort.abort();assert.equal((await bounded(pending)).error.code,'NETWORK_ERROR');await bounded(closed.promise);});});
test('abort after SSE headers ends the original response reader and request',async()=>{const closed=deferred();await withServer((req,res)=>{req.once('close',closed.resolve);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: first\n\n');},async stream=>{const abort=new AbortController(),body=await stream('/api/event',undefined,undefined,abort.signal);assert.ok(body instanceof ReadableStream);const reader=body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/first/);abort.abort();await assert.rejects(reader.read());await bounded(closed.promise);reader.releaseLock();});});
test('HTTP error cancels an unfinished response body and preserves error shape',async()=>{const closed=deferred();await withServer((req,res)=>{req.once('close',closed.resolve);res.writeHead(403,{'Content-Type':'text/event-stream'});res.write('denied');},async stream=>{assert.deepEqual(await stream('/api/event'),{error:{message:'SSE stream failed: HTTP 403',code:'HTTP_403'}});await bounded(closed.promise);});});
test('existing no-signal callers retain query, event cursor and authentication',async()=>{await withServer((req,res)=>{assert.equal(req.url,'/api/event?session=original&offset=0');assert.equal(req.headers.authorization,'Bearer finite-fixture');assert.equal(req.headers['last-event-id'],'original-cursor');res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: done\n\n');},async stream=>{const body=await stream('/api/event',{session:'original',offset:0,omitted:undefined},{'Last-Event-ID':'original-cursor'});assert.equal(await new Response(body).text(),'data: done\n\n');});});
