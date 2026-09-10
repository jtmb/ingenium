"use client";

import { useId, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

export type ListboxNavigationOptions<T> = {
  id: string;
  items: T[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (index: number) => void;
  onClose?: () => void;
  selectKeys?: string[];
  inputRole?: "combobox" | "textbox";
};

export type ListboxNavigation = {
  listboxId: string;
  activeDescendant: string | undefined;
  inputProps: {
    role: "combobox" | "textbox";
    "aria-autocomplete": "list";
    "aria-controls": string;
    "aria-activedescendant": string | undefined;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  getOptionProps: (index: number, selected?: boolean, disabled?: boolean) => {
    id: string;
    role: "option";
    "aria-selected": boolean;
      "aria-disabled": boolean | undefined;
    tabIndex: number;
    "data-active": "true" | undefined;
  };
};

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Shared editable-list navigation for search inputs, autocomplete, and async
 * result pickers. Focus stays in the input and the active option is announced
 * through aria-activedescendant.
 */
export function useListboxNavigation<T>({
  id,
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  onClose,
  selectKeys = ["Enter"],
  inputRole = "combobox",
}: ListboxNavigationOptions<T>): ListboxNavigation {
  const reactId = useId();
  const baseId = safeId(`${id}-${reactId}`);
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeDescendant = items[activeIndex] === undefined ? undefined : optionId(activeIndex);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      onActiveIndexChange(Math.min(activeIndex + 1, items.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      onActiveIndexChange(Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === "Home" && items.length > 0) {
      event.preventDefault();
      onActiveIndexChange(0);
      return;
    }
    if (event.key === "End" && items.length > 0) {
      event.preventDefault();
      onActiveIndexChange(items.length - 1);
      return;
    }
    if (selectKeys.includes(event.key) && items[activeIndex] !== undefined) {
      event.preventDefault();
      onSelect(activeIndex);
    }
  };

  return {
    listboxId,
    activeDescendant,
    inputProps: {
      role: inputRole,
      "aria-autocomplete": "list",
      "aria-controls": listboxId,
      "aria-activedescendant": activeDescendant,
      onKeyDown,
    },
    getOptionProps: (index, selected = false, disabled = false) => ({
      id: optionId(index),
      role: "option",
      "aria-selected": selected || index === activeIndex,
      "aria-disabled": disabled || undefined,
      tabIndex: -1,
      "data-active": index === activeIndex ? "true" : undefined,
    }),
  };
}

export function Listbox({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...props}
      role="listbox"
      className={[
        "max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-primary)] shadow-xl",
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export function ListboxOption({
  children,
  className,
  active,
  selected,
  disabled,
  onClick,
  onMouseEnter,
  "aria-disabled": ariaDisabled,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  active?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      {...props}
      role="option"
      aria-selected={selected ?? active ?? false}
      aria-disabled={disabled || ariaDisabled || undefined}
      tabIndex={-1}
      data-active={active ? "true" : undefined}
      className={[
        "flex min-h-8 w-full cursor-pointer items-center rounded px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-[var(--color-surface-hover)]",
        active ? "bg-[var(--color-surface-selected)] text-[var(--color-selection-text)]" : "text-[var(--color-text-secondary)]",
        disabled ? "cursor-not-allowed opacity-40" : "",
        className,
      ].filter(Boolean).join(" ")}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </div>
  );
}
