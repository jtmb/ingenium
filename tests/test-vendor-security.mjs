// Run in an isolated image container: node --test /path/to/this/file.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {once} from 'node:events';
import {createRequire} from 'node:module';

const vendor = '/usr/local/lib/code-server';
const require = createRequire(vendor + '/package.json');
const vscode = createRequire(vendor + '/lib/vscode/package.json');
async function listening(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {server, url: `http://127.0.0.1:${server.address().port}`};
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function request(url, options = {}, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let text = '';res.setEncoding('utf8');res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({status: res.statusCode, text, headers: res.headers}));
    });req.on('error', reject);req.end(data);
  });
}

test('shell-quote refuses comment-terminating tokens without changing ordinary quoting', () => {
  const quote = vscode('shell-quote').quote;
  assert.equal(quote(['echo', 'hello world']), "echo 'hello world'");
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) assert.throws(() => quote(['echo', 'ok', {comment: 'x'}, `a${terminator}id;#`]));
});

test('body-parser rejects malformed compressed bodies and survives a subsequent valid request', async () => {
  const parse = require('body-parser').json();
  const {server, url} = await listening((req, res) => parse(req, res, error => {
    res.statusCode = error ? 400 : 200;res.end(error ? 'rejected' : JSON.stringify(req.body));
  }));
  try {
    for (const trailing of [Buffer.from('garbage'), Buffer.from([0xff, 0xff, 0xff])]) {
      const payload = Buffer.concat([gzipSync(Buffer.from('{"ok":true}')), trailing]);
      const response = await request(url, {method: 'POST', headers: {'content-type':'application/json','content-encoding':'gzip'}}, payload);
      assert.equal(response.status, 400);
    }
    const response = await request(url, {method:'POST',headers:{'content-type':'application/json'}}, '{"ok":true}');
    assert.equal(response.status, 200);assert.deepEqual(JSON.parse(response.text), {ok:true});
  } finally { await close(server); }
});

test('body-parser survives trailing frames after a completed gzip body', async () => {
  const parse = require('body-parser').json();
  const {server, url} = await listening((req, res) => parse(req, res, error => {
    res.statusCode = error ? 400 : 200;res.end(error ? 'rejected' : JSON.stringify(req.body));
  }));
  try {
    const payload = Buffer.concat([gzipSync(Buffer.from('{"ok":true}')), Buffer.from([0]), Buffer.alloc(128 * 1024, 0x58)]);
    const response = await request(url, {method:'POST', agent:false, headers:{'content-type':'application/json','content-encoding':'gzip','content-length':payload.length}}, payload);
    assert.equal(response.status, 200);assert.deepEqual(JSON.parse(response.text), {ok:true});
    await new Promise(resolve => setTimeout(resolve, 200));
    const after = await request(url, {method:'POST',headers:{'content-type':'application/json'}}, '{"after":true}');
    assert.equal(after.status, 200);
  } finally { await close(server); }
});

for (const directory of ['/usr/local/lib/node_modules/npm/node_modules/undici', vendor + '/lib/vscode/node_modules/undici']) {
  test(`undici survives excessive response encodings: ${directory}`, async () => {
    const client = require(directory);
    const {server, url} = await listening((req, res) => {
      res.writeHead(200, {'content-encoding':'gzip, gzip, gzip, gzip, gzip, gzip','content-length':'100','connection':'close'});res.end();
    });
    try {
      await assert.rejects(client.fetch(url));
      // A subsequent event-loop turn exposes uncaught errors from orphaned streams.
      await new Promise(resolve => setTimeout(resolve, 50));
    } finally { await close(server); }
  });
}

test('follow-redirects drops metacharacter-named sensitive headers across origins', async () => {
  const redirects = require('follow-redirects').http;
  const destination = await listening((req, res) => res.end(JSON.stringify(req.headers)));
  const origin = await listening((req, res) => {res.writeHead(302, {location: destination.url});res.end();});
  try {
    const received = await new Promise((resolve, reject) => {
      const req = redirects.get(origin.url, {headers:{Authorization:'Bearer test-only','x-secret|token':'test-only'}, sensitiveHeaders:['x-secret|token']}, res => {
        let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve(JSON.parse(text)));
      });req.on('error',reject);
    });
    assert.equal(received.authorization, undefined);assert.equal(received['x-secret|token'], undefined);
  } finally { await close(origin.server);await close(destination.server); }
});

for (const directory of [vendor + '/lib/vscode/node_modules/zod', vendor + '/lib/vscode/node_modules/@github/copilot-sdk/node_modules/zod']) {
  test(`Zod 4 vendor schemas remain compatible: ${directory}`, () => {
    const {z} = require(directory);
    const schema = z.object({name:z.string(), count:z.number().int().min(0), tags:z.array(z.string()).max(3)});
    assert.deepEqual(schema.parse({name:'Ingenium',count:2,tags:['a']}), {name:'Ingenium',count:2,tags:['a']});
    assert.equal(schema.safeParse({name:42,count:-1,tags:[true]}).success, false);
    assert.equal(JSON.parse(fs.readFileSync(directory+'/package.json')).version,'4.6.6');
  });
}

test('sandbox retains its required Zod 3 API instead of an unqualified major upgrade', () => {
  const directory=vendor+'/lib/vscode/node_modules/@vscode/sandbox-runtime/node_modules/zod';
  assert.equal(JSON.parse(fs.readFileSync(directory+'/package.json')).version,'3.25.76');
  assert.equal(require(directory).z.string().parse('preserved'), 'preserved');
});
