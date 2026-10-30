// Compile the original TypeScript import graph in memory; no emitted tree or
// substitute runtime. Reuse the existing Core-binding behavioral suite.
import {resolve} from 'node:path';
import {tsModule,root} from './veyra-dot-installed-authority.fixture.mjs';
await import(tsModule(resolve(root,'services/ingenium-api/tests/veyra-dot-core-binding.cpu.mjs')));