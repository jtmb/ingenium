import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{createHash}from'node:crypto';
const root=process.env.VSCODE_REVIEW_ROOT;if(!root?.startsWith('/'))throw Error('Explicit existing integration root required');
const sha=v=>createHash('sha256').update(v).digest('hex'),validator=fs.readFileSync(root+'/scripts/validate-deployment-config.sh','utf8'),entrypoint=fs.readFileSync(root+'/scripts/docker-entrypoint.sh','utf8');
const originalHash='67293f5e64081c885df34b46f5c01b8717dec00491dc2371546d96e0b0b01c42',fixedHash='5d52263e4daad877a7a8068e910ea1c4772c7112fe6fc767e824b4dbaef7b076';
const needle='remove_verified_stale_socket /home/ingenium-vscode/vscode-data/user-data/code-server-ipc.sock "$VSCODE_UID" "$VSCODE_GID"';
const stale='require_literal "$entrypoint" '+"'"+needle+"'",anchor='require_literal "$entrypoint" '+"'validatePackageBinLink(parentDescriptor, name, metadata, rootDevice, relative)'";
let historical=validator;if(sha(validator)===fixedHash){assert.equal(validator.split(anchor+'\n').length,2);historical=validator.replace(anchor+'\n',anchor+'\n'+stale+'\n');}
assert.equal(sha(historical),originalHash,'Stop on unknown source; never present corrected source as defective');assert.equal(sha(entrypoint),'5370a807e56ff50273859867e0059e5ca6f218ea725e061342e173e956928be2');
test('historical source witness: required editor socket conflicts with editor-absence guard and removed entrypoint',()=>{
 assert.ok(historical.includes(stale));assert.ok(historical.includes('reject_literal "$entrypoint" "ingenium-vscode"'));assert.ok(needle.includes('ingenium-vscode'));assert.equal(entrypoint.includes(needle),false);
});
test('Root minimal source correction retains absence guard and removes contradictory requirement',()=>{
 assert.equal(sha(validator),fixedHash);assert.equal(validator.includes(stale),false);assert.ok(validator.includes('reject_literal "$entrypoint" "ingenium-vscode"'));
});
