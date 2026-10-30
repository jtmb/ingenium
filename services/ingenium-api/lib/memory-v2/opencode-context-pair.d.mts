import type {MemoryScope,SqlConnection} from './lifecycle.mjs';
import type {AuthenticatedExecution} from './adapters.mjs';
import type {CompletedEngineMessage} from './bounded-snapshot.mjs';
import type {CanonicalContextPair} from './opencode-snapshot.mjs';
export function mapCanonicalContextPair(db:SqlConnection,input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;user:CompletedEngineMessage;assistant:CompletedEngineMessage}):CanonicalContextPair|null;
export interface ContextPairCandidate extends CanonicalContextPair {user:{id:string;content:string};assistant:{id:string;content:string}}
export function resolveContextPairCandidate(db:SqlConnection,input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;sourceRef:{id:string;contentHash:string}}):ContextPairCandidate|null;
