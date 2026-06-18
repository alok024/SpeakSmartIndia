'use client';

/**
 * components/shared/ErrorBoundary.tsx
 *
 * M3: React Error Boundary.
 *
 * The interview session page has local `phase === 'error'` state for
 * *handled* failures (e.g. AI call failed), but an *uncaught* render
 * exception (bad Zustand mutation, a timer callback throwing, a null
 * access on AI feedback shape, etc.) had no recovery path — it crashed
 * to a white screen.
 *
 * Wrap any complex page in <ErrorBoundary> to catch render-time errors
 * and show a "session crashed — your progress may be saved" message with
 * a retry link instead of a blank page.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppShell } from './AppShell';
import { Button } from '@/components/ui';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback renderer. Receives the error and a reset() callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return <DefaultErrorFallback error={error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <AppShell>
      <div className="p-6 max-w-md mx-auto pt-16 text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-white font-semibold">Something went wrong</p>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          This session crashed unexpectedly. Your progress up to this point may
          already be saved — try again, or head back to set up a new session.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
          <Button onClick={() => { window.location.href = '/interview/setup'; }}>
            ← Back to Setup
          </Button>
        </div>
        <p className="text-[10px] mt-2 break-all" style={{ color: 'var(--text-3)' }}>{error.message}</p>
      </div>
    </AppShell>
  );
}
