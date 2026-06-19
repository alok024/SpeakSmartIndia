'use client';

/**
 * store/ui.ts
 *
 * Zustand UI store — theme, sidebar, upgrade modal, toasts.
 * Single source of truth for dark/light mode: persisted under 'vachix-ui'.
 * The DOM data-theme attribute is synced here directly — no second localStorage key.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UpgradeTrigger } from '@/types';

interface Toast {
  id: string;
  message: string;
  className?: string;
  duration?: number;
}

interface UIStore {
  // Theme
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (dark: boolean) => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;

  // Upgrade modal
  upgradeModalOpen: boolean;
  upgradeTrigger: UpgradeTrigger;
  showUpgradeModal: (trigger?: UpgradeTrigger) => void;
  closeUpgradeModal: () => void;

  // Toasts
  toasts: Toast[];
  showToast: (message: string, opts?: { className?: string; duration?: number }) => () => void;
  removeToast: (id: string) => void;
}

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

      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),

      upgradeModalOpen: false,
      upgradeTrigger: null,
      showUpgradeModal: (trigger = null) =>
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
        const duration = opts.duration ?? 6000;
        setTimeout(remove, duration);
        return remove;
      },
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'vachix-ui',
      partialize: (state) => ({ isDark: state.isDark }),
      // Sync DOM the instant Zustand finishes reading from localStorage.
      // This closes the gap between the blocking script's initial guess
      // and the actual persisted value (e.g. a first-time visitor on light OS).
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeToDom(state.isDark);
      },
    }
  )
);
