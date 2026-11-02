"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string; description?: string; disabled?: boolean };
export function effortLabel(value: string): string {
  if (!value || value === "default") return "Default";
  if (value === "xhigh") return "Extra high";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
export default function ModelEffortPicker({ model, models, effort = "", efforts = [], disabled = false,
  onModelChange, onEffortChange, className = "" }: {
  model: string; models: Option[]; effort?: string; efforts?: Option[]; disabled?: boolean;
  onModelChange: (value: string) => void; onEffortChange: (value: string) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"settings" | "models">("settings");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280, maxHeight: 360 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const enabledEfforts = efforts.filter(option => !option.disabled);
  const selectedModel = models.find(option => option.value === model);
  const selectedEffort = enabledEfforts.find(option => option.value === effort);
  const hasEffort = enabledEfforts.length > 1 && Boolean(selectedModel && !selectedModel.disabled);
  const modelView = view === "models" || !hasEffort;
  const effortIndex = enabledEfforts.findIndex(option => option.value === effort);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const show = () => { setView("settings"); setOpen(true); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 24);
      const above = rect.top - 20, below = window.innerHeight - rect.bottom - 20;
      const maxHeight = Math.max(40, Math.min(360, Math.max(above, below), window.innerHeight - 24));
      const height = Math.min(panel.current?.scrollHeight ?? maxHeight, maxHeight);
      const putAbove = above >= height || above >= below;
      setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: putAbove ? Math.max(12, rect.top - height - 8) : rect.bottom + 8, width, maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, modelView]);
  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); return; }
    const first = modelView
      ? panel.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? panel.current?.querySelector<HTMLElement>('button:not(:disabled)')
      : panel.current?.querySelector<HTMLElement>('button');
    first?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, modelView, disabled]);
  const description = [selectedModel?.label ?? "Select model", hasEffort ? selectedEffort?.label ?? "Unavailable effort" : ""].filter(Boolean).join(" · ");
  return <div className={"veyra-model-effort " + className}>
    <button ref={trigger} type="button" disabled={disabled || !models.some(option => !option.disabled)}
      aria-label="Model and effort" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={description} className="veyra-model-effort-trigger"
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
        if (event.key === "Escape") { event.preventDefault(); close(true); }
      }}>
      <span className="veyra-model-effort-model">{selectedModel?.label ?? "Select model"}</span>
      {hasEffort && <span className="veyra-model-effort-value">{selectedEffort?.label ?? "Unavailable effort"}</span>}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open && !disabled && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Model and effort"
      className="veyra-model-effort-panel" style={position} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (modelView && event.key === "ArrowLeft" && hasEffort) { event.preventDefault(); setView("settings"); return; }
        if (modelView) {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          let next: number | undefined;
          if (event.key === "ArrowDown") next = (index + 1) % items.length;
          if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
          if (event.key === "Home") next = 0;
          if (event.key === "End") next = items.length - 1;
          if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
        }
        if (event.key === "Tab") {
          const inside = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
          const current = inside.indexOf(document.activeElement as HTMLElement);
          const next = current + (event.shiftKey ? -1 : 1);
          event.preventDefault();
          if (next >= 0 && next < inside.length) { inside[next]?.focus(); return; }
          const controls = Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'))
            .filter(element => element.getClientRects().length > 0 && !panel.current?.contains(element));
          const anchor = controls.indexOf(trigger.current!);
          close(); controls[anchor + (event.shiftKey ? -1 : 1)]?.focus();
        }
      }}>
      {modelView ? <>
        <div className="veyra-model-picker-heading">
          {hasEffort && <button type="button" aria-label="Back to model and effort" onClick={() => setView("settings")}>‹</button>}
          <span>Select model</span>
        </div>
        <div role="menu" aria-label="Select model" className="veyra-model-picker-options">
          {models.map(option => <button key={option.value} type="button" role="menuitemradio"
            aria-checked={option.value === model} disabled={option.disabled} tabIndex={option.value === model ? 0 : -1}
            onClick={() => { onModelChange(option.value); close(true); }}>
            <span><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
            <span aria-hidden="true">{option.value === model ? "✓" : ""}</span>
          </button>)}
        </div>
      </> : <>
        <button type="button" className="veyra-model-effort-current" aria-label={"Choose model, current " + selectedModel?.label}
          onClick={() => setView("models")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 3-8 11h6l-1 7 9-12h-6l1-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
          <span><strong>{selectedModel?.label}</strong> <span>{selectedEffort?.label ?? "Unavailable effort"}</span></span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="m3.5 2.5 2.5 2.5-2.5 2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {effortIndex >= 0 ? <div className="veyra-effort-scale"
          style={{ "--effort-progress": (effortIndex / (enabledEfforts.length - 1) * 100) + "%" } as CSSProperties}>
          <input type="range" min={0} max={enabledEfforts.length - 1} step={1} value={effortIndex}
            aria-label="Reasoning effort" aria-valuetext={selectedEffort?.label} title={selectedEffort?.label}
            onChange={event => { const choice = enabledEfforts[Number(event.currentTarget.value)]; if (choice) onEffortChange(choice.value); }} />
          <div className="veyra-effort-stops" aria-hidden="true">
            {enabledEfforts.map((option, index) => <span key={option.value} title={option.label}
              style={{ left: "calc(14px + (100% - 28px) * " + (index / (enabledEfforts.length - 1)) + ")", opacity: index === effortIndex ? 0 : 1 }} />)}
          </div>
        </div> : <button type="button" className="veyra-effort-reset" onClick={() => { const option = enabledEfforts[0]; if (option) onEffortChange(option.value); }}>Use model default</button>}
      </>}
    </div>, document.body)}
  </div>;
}
