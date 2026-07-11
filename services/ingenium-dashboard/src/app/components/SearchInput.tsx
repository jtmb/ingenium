"use client";

import React from "react";

type SearchInputProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
};

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
}: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`w-full border border-gray-200 rounded text-xs px-3 py-1.5 focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200 ${className}`}
    />
  );
}
