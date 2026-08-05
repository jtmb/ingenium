import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
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
    multiple,
    wrapperClassName,
    ...props
  },
  ref,
) {
  return (
    <div className={["relative", wrapperClassName].filter(Boolean).join(" ")}>
      <select
        {...props}
        ref={ref}
        disabled={disabled}
        multiple={multiple}
        className={[selectClassName, className].filter(Boolean).join(" ")}
      >
        {children}
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
    </div>
  );
});

Select.displayName = "Select";

export default Select;
