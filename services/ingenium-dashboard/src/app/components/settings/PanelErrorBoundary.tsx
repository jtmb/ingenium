"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface PanelErrorBoundaryProps {
  panelId: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps one broken settings panel from taking down the whole settings overlay.
 * The boundary is keyed by the active tab by the caller, so switching tabs
 * also gives a failed panel a clean mount when the user returns to it.
 */
export default class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the failure observable without exposing a stack trace in the UI.
    console.error(`Settings panel '${this.props.panelId}' failed to render`, error, info);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="m-6 rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-4"
          role="alert"
          data-testid={`settings-panel-error-${this.props.panelId}`}
        >
          <p className="text-sm font-medium text-[var(--color-error-text)]">
            This settings panel couldn&apos;t load.
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            The rest of Settings is still available. Try loading this panel again.
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-3 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            Retry panel
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
