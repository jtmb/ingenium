import {expect,it,vi} from 'vitest';
// Actual source imports with the API's existing test-only Core source mapping.
// Identity, engine and authorization modules remain actual. The retained route's
// upload-startup cleanup is guarded so this import cannot touch an existing
// task upload directory. This verifies initialization, not execution.
vi.mock('node:fs',async(importOriginal)=>{
 const fs=await importOriginal<typeof import('node:fs')>();const {tmpdir}=await import('node:os');const upload=tmpdir()+'/ingenium-chat-uploads';
 return {...fs,mkdirSync:(...args:Parameters<typeof fs.mkdirSync>)=>String(args[0])===upload?undefined:fs.mkdirSync(...args),readdirSync:(...args:Parameters<typeof fs.readdirSync>)=>String(args[0])===upload?[]:fs.readdirSync(...args)};
});
it('initializes from the real OpenCode route through its Context and voice cycle',async()=>{
 vi.resetModules();const routes=await import('../lib/routes/opencode.js');expect(typeof routes.opencodeRouter).toBe('function');
 const context=await import('../lib/projects-v2/projectless-context.mjs');const binding=await import('../lib/projects-v2/request-execution.js');
 expect(typeof context.createOriginalWorkspaceEngineSession).toBe('function');expect(typeof binding.resolveRequestChatBinding).toBe('function');expect(typeof binding.resolveRequestContextChatBinding).toBe('function');
});
it('also initializes from the real request binding entry',async()=>{
 vi.resetModules();const binding=await import('../lib/projects-v2/request-execution.js');expect(typeof binding.resolveRequestExecution).toBe('function');
 const routes=await import('../lib/routes/opencode.js');expect(typeof routes.opencodeRouter).toBe('function');
});
