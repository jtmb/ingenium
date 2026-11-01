"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string };
export default function ComposerSelect({ label, value, options, disabled = false, onChange }: {
  label: string; value: string; options: Option[]; disabled?: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(288, window.innerWidth - 24);
      const above = rect.top - 20, below = window.innerHeight - rect.bottom - 20;
      const maxHeight = Math.max(40, Math.min(320, Math.max(above, below), window.innerHeight - 24));
      const height = Math.min(panel.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: above >= below ? Math.max(12, rect.top - height - 8) : rect.bottom + 8, width, maxHeight });
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
    if (disabled) { setOpen(false); return; }
    (panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, disabled]);
  return <div className="veyra-composer-choice">
    <button ref={trigger} type="button" disabled={disabled || options.length === 0} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      title={`${label}: ${selected?.label ?? "Unavailable"}`} className="veyra-composer-choice-trigger"
      onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        if (event.key === "Escape") { event.preventDefault(); close(true); }
      }}>
      <span>{selected?.label ?? "Unavailable"}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open && !disabled && createPortal(<div ref={panel} id={id} role="menu" aria-label={label}
      className="veyra-composer-choice-menu" style={position} onKeyDown={event => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = items.length - 1;
        if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === "Tab") {
          event.preventDefault();
          const controls = Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'))
            .filter(element => element.getClientRects().length > 0 && !panel.current?.contains(element));
          const current = controls.indexOf(trigger.current!);
          close(); controls[current + (event.shiftKey ? -1 : 1)]?.focus();
        }
      }}>
      <div className="veyra-composer-choice-heading">{label}</div>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value}
        tabIndex={option.value === value ? 0 : -1} onClick={() => { onChange(option.value); close(true); }}>
        <span>{option.label}</span><span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
      </button>)}
    </div>, document.body)}
  </div>;
}
