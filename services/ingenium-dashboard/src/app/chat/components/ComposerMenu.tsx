"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function ComposerMenu({ onAttach, canAttach, children, onFocusNext }: {
  onAttach: () => void;
  canAttach: boolean;
  children: (close: () => HTMLButtonElement | null) => ReactNode;
  onFocusNext: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); return trigger.current; };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(352, window.innerWidth - 24);
      const above = rect.top - 20;
      const below = window.innerHeight - rect.bottom - 20;
      const height = Math.min(560, Math.max(above, below));
      const measured = Math.min(panel.current?.scrollHeight ?? height, height);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above >= below ? rect.top - measured - 8 : rect.bottom + 8, maxHeight: height });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="veyra-composer-plus-trigger" aria-label="Add to conversation" title="Add to conversation" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); close(); } }}>
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 2v12M2 8h12" strokeLinecap="round"/></svg>
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Add to conversation" className="veyra-chat-plus-panel" style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }} onKeyDown={event => {
      // Child popovers consume Escape before it reaches this layer.
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]')).filter(element => element.getClientRects().length > 0);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); close(); trigger.current?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); close(); onFocusNext(); }
    }}>
      <button type="button" className="veyra-chat-plus-attach" disabled={!canAttach} onClick={() => { close(); onAttach(); }}>Add photos &amp; files</button>
      {children(close)}
    </div>, document.body)}
  </>;
}
