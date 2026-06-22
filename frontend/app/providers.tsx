'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect } from 'react';
import { UpgradeModal } from '@/components/shared/UpgradeModal';
import { ToastStack } from '@/components/shared/ToastStack';
import posthog from 'posthog-js';

// QueryClient — shared config
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          if (error instanceof Error && error.message.includes('401')) return false;
          if (error instanceof Error && error.message.includes('403')) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

// PostHog init
function PostHogInit() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'identified_only',
    });
  }, []);
  return null;
}

// ThemeApplier removed. Theme is now fully managed by:
// 1. Blocking inline script in layout.tsx (migrates ss-* → vachix-*, reads vachix-ui, prevents FOUC)
// 2. Zustand persist onRehydrateStorage (syncs DOM on hydration)
// 3. toggleTheme / setTheme in store/ui.ts (syncs DOM on user action)
// No effect needed here — any useEffect touching toggleTheme caused flicker.

// Root providers
export function Providers({ children }: { children: React.ReactNode }) {
  const qc = getQueryClient();

  return (
    <QueryClientProvider client={qc}>
      <PostHogInit />
      {children}
      <UpgradeModal />
      <ToastStack />
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
