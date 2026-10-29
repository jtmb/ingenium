"use client";

export default function WorkError({ reset }: { reset: () => void }) {
  return <div role="alert" className="p-6"><p>Work could not be loaded. Your runtime conversation remains on its owner.</p>
    <button type="button" onClick={reset} className="mt-3 rounded border px-3 py-2">Reload Work view</button></div>;
}
