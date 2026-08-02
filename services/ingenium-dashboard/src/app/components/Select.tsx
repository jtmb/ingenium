import { Children, forwardRef, useId, type SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  emptyLabel?: string;
  error?: string;
  loading?: boolean;
  wrapperClassName?: string;
};

const selectClassName = [
  "appearance-none",
  "rounded-md",
  "border border-[var(--color-border)]",
  "bg-[var(--color-surface)]",
  "px-3 py-2 pr-8",
  "text-[var(--color-text-primary)]",
  "hover:bg-[var(--color-surface-hover)]",
  "cursor-pointer",
  "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    children,
    className,
    disabled,
    emptyLabel,
    error,
    loading,
    multiple,
    wrapperClassName,
    "aria-busy": ariaBusy,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const descriptionId = `select-description-${useId()}`;
  const state = error ? "error" : loading ? "loading" : Children.toArray(children).length === 0 ? "empty" : null;
  const fallbackLabel = state === "error" ? error : state === "loading" ? "Loading…" : emptyLabel ?? "No options available";
  const describedBy = state ? [ariaDescribedBy, descriptionId].filter(Boolean).join(" ") : ariaDescribedBy;
  const stateDisabled = state !== null;

  return (
    <div className={["relative", wrapperClassName].filter(Boolean).join(" ")}>
      <select
        {...props}
        ref={ref}
        aria-busy={loading ? true : ariaBusy}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : ariaInvalid}
        disabled={disabled || stateDisabled}
        multiple={multiple}
        className={[selectClassName, className].filter(Boolean).join(" ")}
      >
        {state ? <option disabled value="">{fallbackLabel}</option> : children}
      </select>
      {!multiple && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-text-secondary)]"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          focusable="false"
        >
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state && (
        <span id={descriptionId} className="sr-only" role={state === "error" ? "alert" : "status"}>
          {fallbackLabel}
        </span>
      )}
    </div>
  );
});

Select.displayName = "Select";

export default Select;
