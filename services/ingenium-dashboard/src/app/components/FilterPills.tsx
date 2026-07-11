"use client";

import React from "react";

type PillOption = {
  key: string;
  label: string;
  color?: string;
};

type FilterPillsProps = {
  options: PillOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  label?: string;
  multi?: boolean;
};

export default function FilterPills({
  options,
  selected,
  onToggle,
  label,
}: FilterPillsProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {label && (
        <span className="text-xs text-gray-400 mr-1 font-medium">{label}</span>
      )}
      {options.map((opt) => {
        const isSelected = selected.has(opt.key);
        return (
          <button
            key={opt.key}
            onClick={() => onToggle(opt.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isSelected
                ? opt.color
                  ? `bg-${opt.color}-50 text-${opt.color}-700 border-${opt.color}-200 shadow-sm ring-1 ring-offset-1 border`
                  : "bg-gray-800 text-white shadow-sm"
                : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
