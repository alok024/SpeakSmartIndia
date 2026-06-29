'use client';

/**
 * features/push/hooks/index.ts
 *
 * usePushSubscription — manages Web Push opt-in for the current user.
 *
 * Call usePushSubscription() on the dashboard. It:
 *   1. Fetches the VAPID public key from the backend.
 *   2. Calls PushManager.subscribe() with that key.
 *   3. POSTs the resulting PushSubscription to /api/push/subscribe.
 *
 * The hook exposes:
 *   subscribe()    — async, triggers the browser permission prompt
 *   unsubscribe()  — removes the subscription from the backend + browser
 *   isSubscribed   — current state (null = unknown, true/false = resolved)
 *   isLoading      — true while an async operation is in progress
 *
 * Design:
 *   - Idempotent: re-subscribing with the same endpoint is a no-op server-side.
 *   - Silent fail-safe: if the backend VAPID key endpoint returns an error or
 *     the browser doesn't support push, isSubscribed stays null and no error
 *     is surfaced to the UI (push is a soft feature, not a hard requirement).
 */

import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '@/lib/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const bytes   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function usePushSubscription() {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading,    setIsLoading]    = useState(false);

  // Detect current subscription state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setIsSubscribed(false);
      return;
    }

    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setIsSubscribed(sub !== null))
      .catch(() => setIsSubscribed(false));
  }, []);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setIsLoading(true);

    try {
      // Fetch VAPID public key
      const keyRes = await apiCall<{ publicKey: string }>('/push/vapid-public-key');
      if (!keyRes.ok || !keyRes.data?.publicKey) return;

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey),
      });

      const json = subscription.toJSON();
      await apiCall('/push/subscribe', 'POST', {
          endpoint: json.endpoint,
          keys:     json.keys,
      });

      setIsSubscribed(true);
    } catch {
      // Permission denied or backend error — silently do nothing
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    setIsLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setIsSubscribed(false); return; }

      await apiCall('/push/unsubscribe', 'DELETE', {
          endpoint: sub.endpoint,
      });

      await sub.unsubscribe();
      setIsSubscribed(false);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { isSubscribed, isLoading, subscribe, unsubscribe };
}
