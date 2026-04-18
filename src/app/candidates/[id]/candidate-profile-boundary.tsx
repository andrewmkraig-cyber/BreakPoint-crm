"use client";

import { Component, type ReactNode } from "react";

// Error boundary for the whole candidate profile tree. If any client island
// inside here throws during render, we show a readable message instead of
// Next.js's full-page "Application error" (which on some browsers displays
// the raw RSC payload visibly).
//
// Use client-side state so a "Try again" button can reset without a full
// navigation. The caught error is also logged to console for inspection.
export class CandidateProfileBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[candidate-profile] render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <div className="font-semibold">Something went wrong rendering this candidate profile.</div>
          <div className="mt-1 font-mono text-xs">{this.state.error}</div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
