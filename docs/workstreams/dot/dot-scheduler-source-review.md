# Dot scheduler bounded source review

P2: `services/ingenium-api/lib/dot-v2/core-binding.ts:229-245` advances recovery to the final row of a page before handling its rows, then aborts on an ordinary manager/context error. Persistent unavailable A can starve healthy B in the same page after every wrap. Actual-source loop witness: A attempted three times, B zero times. Keep authority failure closed while isolating each operation or progressing after each attempted row.

No other concrete P1/P2 finding was established in the dispatch/ALS/managedDispatch/no-independent-claim wiring. Source review is not runtime or phase completion. No shared writes, builds, service, model or desktop use. Removed paths none; removed bytes 0. Compact unique review evidence retained under existing task root for Root fix review.
