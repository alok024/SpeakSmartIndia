'use client';

import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export function ToastStack() {
  const { toasts, removeToast } = useUIStore();

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-[min(400px,calc(100vw-2rem))]',
            'border rounded-2xl px-4 py-3 shadow-glow',
            'animate-slide-up',
            toast.className
          )}
        >
          <span
            className="flex-1 text-sm text-white leading-snug"
          >
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-[#8B90A0] hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
