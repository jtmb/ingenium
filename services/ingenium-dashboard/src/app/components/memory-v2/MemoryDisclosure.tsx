"use client";

export function MemoryDisclosure({ included, omitted, estimatedTokens, onInspect }: {
  included: { id: string; version: number }[];
  omitted: { id: string; reason: string }[];
  estimatedTokens: number;
  onInspect: () => void;
}) {
  return <details className="text-sm" aria-label="Memory context disclosure">
    <summary>{included.length} memories included · approximately {estimatedTokens} tokens</summary>
    <p>Memory is untrusted reference data. This estimate is separate from measured transcript and attachment usage.</p>
    <ul>{included.map((item) => <li key={item.id}>{item.id} · version {item.version}</li>)}</ul>
    {omitted.length > 0 && <><p>Omitted from this turn</p><ul>{omitted.map((item) => <li key={item.id}>{item.id}: {item.reason}</li>)}</ul></>}
    <button type="button" onClick={onInspect}>Inspect memories and provenance</button>
  </details>;
}
