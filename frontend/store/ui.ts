'use client';

/**
 * store/ui.ts
 *
 * Zustand UI store — theme, sidebar state, upgrade modal, and toast queue.
 *
 * Theme persistence
 * ─────────────────
 * `isDark` is persisted under the 'vachix-ui' key in localStorage.
 * The DOM data-theme attribute is synced here via applyThemeToDom() and
 * also on rehydration (onRehydrateStorage), so the theme snaps into place
 * as soon as Zustand reads from localStorage — closing the potential flash
 * between the page's blocking <script> initial guess and the actual stored value.
 *
 * Upgrade modal
 * ─────────────
 * showUpgradeModal(trigger) accepts an optional UpgradeTrigger that lets the
 * modal tailor its copy to the context that caused it to open (e.g. "You've
 * hit your AI call limit" vs "This feature requires Pro").
 *
 * Toasts
 * ──────
 * showToast() returns a `remove` function the caller can invoke early (e.g.
 * on an "Undo" action) without waiting for the auto-dismiss timer. Each toast
 * has a randomly generated ID so concurrent toasts don't interfere.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UpgradeTrigger } from '@/types';

interface Toast {
  id:        string;
  message:   string;
  className?: string;
  duration?:  number;
}

interface UIStore {
  // Theme
  isDark:       boolean;
  toggleTheme:  () => void;
  setTheme:     (dark: boolean) => void;

  // Sidebar
  sidebarOpen:   boolean;
  toggleSidebar: () => void;
  closeSidebar:  () => void;

  // Upgrade modal
  upgradeModalOpen:  boolean;
  upgradeTrigger:    UpgradeTrigger;
  showUpgradeModal:  (trigger?: UpgradeTrigger) => void;
  closeUpgradeModal: () => void;

  // Toasts
  toasts:      Toast[];
  showToast:   (message: string, opts?: { className?: string; duration?: number }) => () => void;
  removeToast: (id: string) => void;
}

/** Writes the data-theme attribute to the document root. SSR-safe. */
function applyThemeToDom(dark: boolean) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      isDark: true,

      toggleTheme: () => {
        const next = !get().isDark;
        set({ isDark: next });
        applyThemeToDom(next);
      },

      setTheme: (dark: boolean) => {
        set({ isDark: dark });
        applyThemeToDom(dark);
      },

      sidebarOpen:   false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar:  () => set({ sidebarOpen: false }),

      upgradeModalOpen:  false,
      upgradeTrigger:    null,
      showUpgradeModal:  (trigger = null) =>
        set({ upgradeModalOpen: true, upgradeTrigger: trigger }),
      closeUpgradeModal: () =>
        set({ upgradeModalOpen: false, upgradeTrigger: null }),

      toasts: [],

      showToast: (message, opts: { className?: string; duration?: number } = {}) => {
        const id = crypto.randomUUID();
        set((s) => ({
          toasts: [...s.toasts, { id, message, ...opts }],
        }));
        const remove = () => get().removeToast(id);
        setTimeout(remove, opts.duration ?? 6000);
        return remove;
      },

      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name:       'vachix-ui',
      partialize: (state) => ({ isDark: state.isDark }),

      // Sync the DOM immediately when Zustand finishes reading localStorage.
      // Without this, a user who set light mode would see a dark flash on
      // every page load until the hydration cycle completes.
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeToDom(state.isDark);
      },
    }
  )
);
