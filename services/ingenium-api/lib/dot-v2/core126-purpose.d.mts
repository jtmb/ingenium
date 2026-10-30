export type StoredManagedPurpose = Readonly<{purpose:'production';candidateIntentHash:null}> | Readonly<{purpose:'candidate-inert-v1';candidateIntentHash:string}>;
/** Data validation, not admission authority. Input must be read by the original Core owner. */
export function describeStoredManagedPurpose(row:Readonly<Record<string,unknown>>):StoredManagedPurpose;
export function requireProductionManagedPurpose(row:Readonly<Record<string,unknown>>):Readonly<{purpose:'production';candidateIntentHash:null}>;
