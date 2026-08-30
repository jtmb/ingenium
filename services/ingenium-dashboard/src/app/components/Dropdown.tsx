"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

type DropdownContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerId: string;
  panelId: string;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
};

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext(): DropdownContextValue {
  const context = useContext(DropdownContext);
  if (!context) throw new Error("Dropdown components must be used inside Dropdown");
  return context;
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export type DismissableLayerOptions = {
  open: boolean;
  onClose: () => void;
  containerRef: React.MutableRefObject<HTMLElement | null>;
  restoreFocusRef?: React.MutableRefObject<HTMLElement | null>;
};

/** Shared outside-click and Escape behavior for menus and combobox popovers. */
export function useDismissableLayer({
  open,
  onClose,
  containerRef,
  restoreFocusRef,
}: DismissableLayerOptions): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        requestAnimationFrame(() => restoreFocusRef?.current?.focus());
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, onClose, open, restoreFocusRef]);
}

export type DropdownProps = {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function Dropdown({ children, open: controlledOpen, defaultOpen = false, onOpenChange, className }: DropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const reactId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const triggerId = `${stableId(reactId)}-trigger`;
  const panelId = `${stableId(reactId)}-panel`;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useDismissableLayer({
    open,
    onClose: () => setOpen(false),
    containerRef: rootRef,
    restoreFocusRef: triggerRef,
  });

  useEffect(() => {
    if (wasOpenRef.current && !open) requestAnimationFrame(() => triggerRef.current?.focus());
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const firstItem = panelRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"])',
      );
      firstItem?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerId, panelId, triggerRef, panelRef }}>
      <div ref={rootRef} className={className ?? "relative"}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export type DropdownTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export const DropdownTrigger = forwardRef<HTMLButtonElement, DropdownTriggerProps>(function DropdownTrigger(
  { children, onClick, disabled, ...props },
  forwardedRef,
) {
  const { open, setOpen, triggerId, panelId, triggerRef } = useDropdownContext();

  const setRefs = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <button
      {...props}
      ref={setRefs}
      id={props.id ?? triggerId}
      type={props.type ?? "button"}
      disabled={disabled}
      aria-haspopup={props["aria-haspopup"] ?? "menu"}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) setOpen(!open);
      }}
    >
      {children}
    </button>
  );
});

export type DropdownPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  role?: "menu" | "listbox";
};

export function DropdownPanel({ children, className, onKeyDown, role = "menu", ...props }: DropdownPanelProps) {
  const { open, panelId, panelRef, setOpen, triggerRef } = useDropdownContext();
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (!open) return null;

  const moveFocus = (direction: 1 | -1 | "first" | "last") => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      role === "menu" ? '[role="menuitem"]' : '[role="option"]',
    ) ?? []).filter((item) => item.getAttribute("aria-disabled") !== "true" && !item.hasAttribute("disabled"));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = direction === "first"
      ? 0
      : direction === "last"
        ? items.length - 1
        : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      {...props}
      ref={panelRef}
      id={props.id ?? panelId}
      role={role}
      tabIndex={-1}
      className={[
        "absolute z-50 mt-1 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-primary)] shadow-xl",
        className,
      ].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveFocus("first");
        } else if (event.key === "End") {
          event.preventDefault();
          moveFocus("last");
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          requestAnimationFrame(() => triggerRef.current?.focus());
        } else if (role === "menu" && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeaheadRef.current += event.key.toLowerCase();
          if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
          typeaheadTimerRef.current = setTimeout(() => { typeaheadRef.current = ""; }, 500);
          const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
            .filter((item) => item.getAttribute("aria-disabled") !== "true" && !item.hasAttribute("disabled"));
          const match = items.find((item) => (item.textContent ?? "").trim().toLowerCase().startsWith(typeaheadRef.current));
          if (match) {
            event.preventDefault();
            match.focus();
          }
        }
      }}
    >
      {children}
    </div>
  );
}

export type DropdownItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  selected?: boolean;
  closeOnSelect?: boolean;
};

export const DropdownItem = forwardRef<HTMLButtonElement, DropdownItemProps>(function DropdownItem(
  { children, className, onClick, selected, closeOnSelect = true, disabled, ...props },
  ref,
) {
  const { setOpen } = useDropdownContext();
  return (
    <button
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      role="menuitem"
      aria-disabled={disabled || undefined}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      disabled={disabled}
      className={[
        "flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-[var(--color-surface-hover)] focus:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        selected ? "bg-[var(--color-surface-selected)] text-[var(--color-selection-text)]" : "text-[var(--color-text-secondary)]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        className,
      ].filter(Boolean).join(" ")}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented && closeOnSelect) {
          setOpen(false);
        }
      }}
    >
      {children}
    </button>
  );
});

export function DropdownSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="separator" className={["my-1 border-t border-[var(--color-border-muted)]", className].filter(Boolean).join(" ")} />;
}

export function DropdownLabel({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div {...props} className={["px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)]", className].filter(Boolean).join(" ")}>{children}</div>;
}
