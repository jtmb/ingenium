"use client";

import React from "react";

type Stat = {
  label: string;
  value: number | string;
  color?: string;
};

type StatusPill = {
  label: string;
  variant: "live" | "paused";
  onClick?: () => void;
};

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  stats?: Stat[];
  statusPill?: StatusPill;
  variant?: "card" | "plain";
  children?: React.ReactNode;
};

const STATUS_STYLES: Record<StatusPill["variant"], string> = {
  live: "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100",
  paused: "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100",
};

export default function PageHeader({
  title,
  subtitle,
  stats,
  statusPill,
  variant = "card",
  children,
}: PageHeaderProps) {
  const inner = (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4 text-sm text-gray-600">
        {stats?.map((s, i) => (
          <span key={i}>
            {s.label}:{" "}
            <strong className={s.color ? `text-${s.color}-600` : undefined}>
              {s.value}
            </strong>
          </span>
        ))}
        {statusPill && (
          <button
            onClick={statusPill.onClick}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              STATUS_STYLES[statusPill.variant]
            }`}
          >
            {statusPill.label}
          </button>
        )}
        {children}
      </div>
    </div>
  );

  if (variant === "plain") {
    return inner;
  }

  return (
    <div className="bg-white border rounded p-4 hover:shadow-md transition-shadow">
      {inner}
    </div>
  );
}
