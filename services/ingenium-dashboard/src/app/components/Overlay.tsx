"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

type OverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fullScreen?: boolean;
  children: React.ReactNode;
};

export default function Overlay({ isOpen, onClose, title, subtitle, fullScreen, children }: OverlayProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      {/* Panel */}
      <div className={`relative bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col ${
        fullScreen
          ? "w-[calc(100%-32px)] h-[calc(100%-32px)] m-4 max-w-none"
          : "mt-8 mb-8 w-11/12 max-w-7xl max-h-[90vh]"
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate">{title}</h2>
            {subtitle && <p className="text-sm text-[var(--color-text-muted)] truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto px-6 py-4 ${fullScreen ? "flex flex-col" : ""}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
