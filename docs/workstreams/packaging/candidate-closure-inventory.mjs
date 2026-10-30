// Fixed source inventory: no globs and no runtime/module execution.
export const CANDIDATE_EXECUTABLES=Object.freeze([
 'packages/veyra-operations/core126-candidate-material.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-carrier.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-docker-stream.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-loopback.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-original-invocation.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-private-plugin.mjs',
 'services/ingenium-api/scripts/runtime-candidate-bootstrap.ts',
]);
export const AUTHORITY_EXECUTABLES=Object.freeze([
 'packages/veyra-operations/core126-image-contract.mjs',
 'packages/veyra-operations/core126-manager-proof.mjs',
 'services/ingenium-api/lib/dot-v2/core126-actual-factory.ts',
 'services/ingenium-api/lib/dot-v2/dot-original-context.ts',
 'services/ingenium-api/lib/dot-v2/installed-dot-approved-scope.ts',
 'services/ingenium-api/lib/dot-v2/dot-approved-scope.mjs',
 'services/ingenium-api/lib/dot-v2/dot-job-policy.mjs',
 'services/ingenium-api/lib/dot-v2/repository.ts',
 'services/ingenium-api/lib/dot-v2/request-binding.ts',
 'services/ingenium-api/lib/dot-v2/service.ts',
 'services/ingenium-api/lib/dot-v2/schedule.ts',
 'services/ingenium-api/lib/dot-v2/existing-jobs.ts',
 'services/ingenium-api/lib/projects-v2/request-chat-source.mjs',
 'services/ingenium-api/lib/job-response-verification.ts',
 'services/ingenium-api/lib/runtime-manager-client.ts',
 'services/ingenium-api/lib/runtime-manager-auth.ts',
 'services/ingenium-api/lib/runtime-placement-contract.ts',
 'services/ingenium-api/lib/dot-v2/core126-runtime.ts',
 'services/ingenium-api/lib/dot-v2/core126-provider-resolution.ts',
 'services/ingenium-api/lib/job-native-provider.ts',
 'services/ingenium-api/lib/opencode-client.ts',
 'services/ingenium-api/lib/dot-v2/managed-job-owner.mjs',
 'services/ingenium-api/lib/dot-v2/managed-job-core-client.mjs',
 'services/ingenium-api/lib/dot-v2/core126-broker.ts',
 'services/ingenium-api/lib/dot-v2/core126-broker.mjs',
 'packages/ingenium-core/lib/index.ts',
 'packages/ingenium-core/lib/db.ts',
 'packages/ingenium-core/lib/schema.ts',
 'packages/ingenium-core/lib/tools/dot-execution-delegation.ts',
 'packages/ingenium-core/lib/tools/jobs.ts',
 'packages/ingenium-core/lib/tools/runtimes.ts',
 'packages/ingenium-core/lib/tools/context-conversations.ts',
 'packages/ingenium-core/lib/tools/trusted-job-events.ts',
 'packages/ingenium-core/lib/tools/agents.ts',
 'packages/ingenium-core/lib/tools/authorization.ts',
 'packages/ingenium-core/lib/tools/mcp-authorization-policy.ts',
 'packages/ingenium-core/lib/tools/job-providers.ts',
 'packages/ingenium-core/lib/tools/vault.ts',
 'packages/ingenium-core/lib/tools/runtime-original-provision.ts',
 'packages/ingenium-core/lib/tools/authentication.ts',
]);
export const BUILD_CONTRACT_INPUTS=Object.freeze([
 ...CANDIDATE_EXECUTABLES.filter(p=>p.endsWith('.mjs')).map(p=>p.slice(0,-4)+'.d.mts'),
 'packages/veyra-operations/core126-candidate-observation.d.mts',
 'packages/veyra-operations/core126-image-owner.d.mts',
 'services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts',
 'scripts/validate-deployment-config.sh',
 'services/ingenium-api/tsconfig.json',
 'packages/ingenium-core/tsconfig.json',
 'tsconfig.base.json',
 'services/ingenium-api/package.json',
 'packages/ingenium-core/package.json',
 'packages/ingenium-core/data/migrations/126_managed_job_execution.sql',
 'packages/ingenium-core/data/migrations/129_managed_candidate_purpose.sql',
 'packages/ingenium-core/data/migrations/130_dot_original_dispatch_fence.sql',
]);
export const COMPILED_RELOCATION_SOURCES=Object.freeze([
 'services/ingenium-api/scripts/runtime-manager.ts',
 'services/ingenium-api/lib/dot-v2/dot-original-context.ts',
 'services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts',
 'services/ingenium-api/lib/dot-v2/core126-actual-factory.ts',
 'services/ingenium-api/lib/dot-v2/core126-runtime.ts',
]);
export function imageArtifact(p){
 if(p.startsWith('packages/veyra-operations/')&&p.endsWith('.mjs'))return '/app/services/ingenium-api/dist/veyra-packages/'+p.slice('packages/'.length);
 if(p.startsWith('services/ingenium-api/')&&p.endsWith('.mjs'))return '/app/services/ingenium-api/dist/'+p.slice('services/ingenium-api/'.length);
 if(p.startsWith('services/ingenium-api/')&&p.endsWith('.ts'))return '/app/services/ingenium-api/dist/'+p.slice('services/ingenium-api/'.length,-3)+'.js';
 if(p.startsWith('packages/ingenium-core/lib/')&&p.endsWith('.ts'))return '/app/packages/ingenium-core/dist/'+p.slice('packages/ingenium-core/'.length,-3)+'.js';
 throw Error('Unreviewed executable artifact mapping: '+p);
}
