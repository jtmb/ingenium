import type {MemoryScope,SqlConnection} from './lifecycle.mjs';
import type {AuthenticatedExecution} from './adapters.mjs';
import type {CompletedEngineMessage} from './bounded-snapshot.mjs';
import type {CanonicalContextPair} from './opencode-snapshot.mjs';
export function mapCanonicalContextPair(db:SqlConnection,input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;user:CompletedEngineMessage;assistant:CompletedEngineMessage}):CanonicalContextPair|null;
