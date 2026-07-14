"use client";
import React from "react";

interface Props { children: React.ReactNode; emailSubject?: string; }
interface State { hasError: boolean; errorMessage: string; }

export default class EmailErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[EmailErrorBoundary] Failed to render email:", error.message, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 min-w-[400px] flex flex-col items-center justify-center gap-3 p-4" data-testid="email-error-boundary">
          <p className="text-sm font-medium text-[var(--color-error-text)]">
            This email couldn't be displayed
          </p>
          {this.props.emailSubject && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Subject: {this.props.emailSubject}
            </p>
          )}
          <p className="text-xs text-[var(--color-text-muted)]">
            The email contains content that cannot be rendered safely.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
