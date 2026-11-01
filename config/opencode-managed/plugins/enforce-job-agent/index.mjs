// Immutable native plugin entry; original API private producers are copied in the same approved image closure.
import {createOriginalPrivateJobPlugin} from "/app/services/ingenium-api/dist/lib/dot-v2/job-private-plugin.mjs";
import {createOriginalCandidatePrivatePlugin} from "/app/services/ingenium-api/dist/lib/dot-v2/candidate-private-plugin.mjs";
// Production's original closed child env excludes this candidate-only selector.
// Candidate producer still revalidates actual private Core purpose/child/material.
export default process.env.INGENIUM_CANDIDATE_ORIGINAL_BINDING===undefined?createOriginalPrivateJobPlugin():createOriginalCandidatePrivatePlugin();
