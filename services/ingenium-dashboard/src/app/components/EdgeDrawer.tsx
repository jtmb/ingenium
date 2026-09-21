"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TransitionEvent,
} from "react";

type EdgeDrawerSide = "left" | "right";
type EdgeDrawerPhase = "opening" | "open" | "closing" | "closed";

type DrawerElementProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "onClick" | "onTransitionEnd" | "onTransitionCancel"
> & { [key: `data-${string}`]: string | undefined };

export interface EdgeDrawerProps {
  open: boolean;
  side: EdgeDrawerSide;
  children: ReactNode;
  className?: string;
  panelClassName: string;
  backdropClassName?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  outerProps?: DrawerElementProps;
  panelProps?: DrawerElementProps;
  backdropProps?: DrawerElementProps;
  onBackdropClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onClosed?: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scheduleNextFrame(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  queueMicrotask(callback);
  return () => undefined;
}

/** Presence and motion lifecycle shared by every edge-mounted drawer. */
export default function EdgeDrawer({
  open,
  side,
  children,
  className = "",
  panelClassName,
  backdropClassName = "absolute inset-0 bg-black/50",
  panelRef,
  outerProps,
  panelProps,
  backdropProps,
  onBackdropClick,
  onClosed,
}: EdgeDrawerProps) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<EdgeDrawerPhase>(open ? "opening" : "closed");
  const mountedRef = useRef(mounted);
  const phaseRef = useRef(phase);
  const wasOpenRef = useRef(open);
  if (open) {
    mountedRef.current = true;
    wasOpenRef.current = true;
  }
  phaseRef.current = phase;

  useEffect(() => {
    if (open || mounted || phase !== "closed" || !wasOpenRef.current) return;
    wasOpenRef.current = false;
    onClosed?.();
  }, [mounted, onClosed, open, phase]);

  useEffect(() => {
    if (open) {
      mountedRef.current = true;
      setMounted(true);
      if (prefersReducedMotion()) {
        phaseRef.current = "open";
        setPhase("open");
        return undefined;
      }
      phaseRef.current = "opening";
      setPhase("opening");
      return scheduleNextFrame(() => {
        phaseRef.current = "open";
        setPhase("open");
      });
    }

    if (!mountedRef.current) return undefined;
    if (prefersReducedMotion()) {
      phaseRef.current = "closed";
      mountedRef.current = false;
      setMounted(false);
      setPhase("closed");
      return undefined;
    }
    phaseRef.current = "closing";
    setPhase("closing");
    return undefined;
  }, [open]);

  const handleTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (!open && phaseRef.current === "closing") {
      phaseRef.current = "closed";
      mountedRef.current = false;
      setMounted(false);
      setPhase("closed");
    }
  }, [open]);

  if (!mounted && !open && !mountedRef.current) return null;

  const renderedPhase = open && phase === "closed" ? "opening" : phase;

  const outerClassName = [
    "edge-drawer",
    className,
    open ? "pointer-events-auto" : "pointer-events-none",
  ].filter(Boolean).join(" ");

  return (
    <div
      {...outerProps}
      className={outerClassName}
      data-edge-drawer-mounted="true"
      data-edge-drawer-open={String(open)}
      data-edge-drawer-phase={renderedPhase}
    >
      <div
        {...backdropProps}
        className={["edge-drawer-backdrop", backdropClassName].filter(Boolean).join(" ")}
        data-edge-drawer-state={renderedPhase}
        aria-hidden="true"
        onClick={onBackdropClick}
      />
      <div
        {...panelProps}
        ref={panelRef}
        className={["edge-drawer-panel", panelClassName].filter(Boolean).join(" ")}
        data-edge-drawer-panel="true"
        data-edge-drawer-side={side}
        data-edge-drawer-state={renderedPhase}
        aria-hidden={!open}
        inert={!open}
        onTransitionEnd={handleTransitionEnd}
        onTransitionCancel={handleTransitionEnd}
      >
        {children}
      </div>
    </div>
  );
}
