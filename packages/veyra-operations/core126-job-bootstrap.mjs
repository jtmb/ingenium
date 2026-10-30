import {verifyCore126AgentMaterial,core126AgentOverlay,JOB_CONFIG} from './core126-agent-material.mjs';
import {core126ClosedJobConfig,JOB_CONFIG_DIRECTORY} from './core126-job-plugin.mjs';
import {freeze,unavailable} from './core126-image-contract.mjs';
/** Root's private TS wrapper supplies the ORIGINAL credential/frame/file/API/child
 * owners. No new auth reader, process command, token or runtime path selector. */
export async function bootstrapCore126Job(ports){
 for(const name of ['readOriginalJobFrame','validateOriginalProtectedDeployment','writeOriginalPrivateCapability','fetchOriginalAssignment','writeOriginalPrivateJson','assertOriginalImageIsolation','runOriginalChild'])if(typeof ports?.[name]!=='function')unavailable('original job bootstrap producer missing');
 await ports.validateOriginalProtectedDeployment();
 const frame=await ports.readOriginalJobFrame({maxBytes:384*1024+256});
 if(!frame||typeof frame.capability!=='string'||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(frame.capability))unavailable('original job attach frame');
 await ports.writeOriginalPrivateCapability('/run/ingenium-runtime/capability',frame.capability);
 const expected=await ports.fetchOriginalAssignment();
 const material=verifyCore126AgentMaterial(frame.agentMaterial,expected.binding,expected.agent,ports.now?.()??Date.now());
 const overlay=core126AgentOverlay(material,expected.binding,expected.agent,ports.now?.()??Date.now());
 const config=core126ClosedJobConfig();
 await ports.assertOriginalImageIsolation({material,expected,config,configDirectory:JOB_CONFIG_DIRECTORY,managedConfig:JOB_CONFIG});
 // Private native overlay is a file, never agent content in environment/image manifest.
 await ports.writeOriginalPrivateJson(JOB_CONFIG_DIRECTORY+'/opencode.json',overlay);
 await ports.writeOriginalPrivateJson('/run/ingenium-runtime/job/material.json',material);
 // Original child must preserve these fixed switches in its existing env allowlist.
 // It still fetches/revalidates original assignment, model and run/attempt itself.
 return await ports.runOriginalChild(freeze({environment:{OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_CONFIG_DIR:JOB_CONFIG_DIRECTORY,OPENCODE_CONFIG:JOB_CONFIG,INGENIUM_MCP_AUDIENCE:'job-run'},originalBinding:expected.binding}));
}