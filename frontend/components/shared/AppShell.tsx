'use client';

/**
 * components/shared/AppShell.tsx
 *
 * App chrome: sidebar + topbar. Uses the same violet/gold logo mark and
 * CSS-var design tokens as the landing page so the product feels like one
 * thing, not two different sites stitched together.
 */

import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useLogout } from '@/features/auth/hooks';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SectionLabel } from '@/components/ui';
import {
  LayoutDashboard, Play, History, User, Gift,
  MessageSquare, LogOut, Sun, Moon, Menu, X,
} from 'lucide-react';
import Link from 'next/link';

const NAV = [
  { href: '/dashboard',        label: 'Dashboard',       icon: LayoutDashboard, section: 'Practice' },
  { href: '/interview/setup',  label: 'New Interview',   icon: Play },
  { href: '/english',          label: 'English Practice',icon: MessageSquare,   badge: 'NEW' },
  { href: '/history',          label: 'Past Sessions',   icon: History,         proBadge: true },
  { href: '/profile',          label: 'Profile & Plan',  icon: User,            section: 'Account' },
  { href: '/referral',         label: 'Refer & Earn',    icon: Gift,            freeOnly: true },
] as const;

/** Violet→gold gradient logo mark, matches landing page exactly */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="appLogoG" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <path d="M16 2C8.27 2 2 7.85 2 15.1c0 3.62 1.55 6.9 4.1 9.26-.18 1.84-.74 3.4-1.62 4.74-.2.3.05.7.4.64 2.4-.4 4.46-1.4 6.1-2.62 1.55.55 3.25.86 5.02.86 7.73 0 14-5.85 14-13.1S23.73 2 16 2Z"
        fill="url(#appLogoG)" />
      <path d="M10.5 17.5c1.2 1.7 3.2 2.8 5.5 2.8s4.3-1.1 5.5-2.8"
        stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="11.5" cy="13" r="1.6" fill="var(--bg)" />
      <circle cx="20.5" cy="13" r="1.6" fill="var(--bg)" />
    </svg>
  );
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':          'Dashboard',
  '/interview/setup':    'New Interview',
  '/interview/session':  'Session',
  '/interview/summary':  'Session Report',
  '/english':            'English Practice',
  '/history':            'Past Sessions',
  '/profile':            'Profile & Plan',
  '/referral':           'Refer & Earn',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, closeSidebar, toggleSidebar, isDark, toggleTheme } = useUIStore();
  const { user } = useAuthStore();
  const pathname = usePathname();
  const router   = useRouter();
  const logout   = useLogout();

  const isFree = !user?.plan || (user.plan !== 'pro' && user.plan !== 'elite');
  const planLabel =
    user?.plan === 'elite' ? '◈ Elite' :
    user?.plan === 'pro'   ? '✦ Pro' : 'Free';
  const name   = user?.name || user?.email?.split('@')[0] || '?';
  const avatar = name[0].toUpperCase();

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-app)' }}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-56 flex flex-col',
          'border-r transition-transform duration-300 ease-out',
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          'lg:translate-x-0 lg:shadow-none'
        )}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Logo wordmark */}
        <Link
          href="/dashboard"
          onClick={closeSidebar}
          className="flex items-center gap-2.5 px-5 h-14 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <LogoMark />
          <span
            className="text-[15px] font-bold tracking-tight"
            style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--text-1)' }}
          >
            Speak<span style={{ color: 'var(--accent)', fontStyle: 'normal' }}>Smart</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {NAV.map((item, i) => {
            if ('freeOnly' in item && item.freeOnly && !isFree) return null;
            const active = pathname === item.href;
            const prevSection = i > 0 && 'section' in NAV[i] ? (NAV[i] as any).section : null;
            const showSection = 'section' in item && item.section && item.section !== (i > 0 && 'section' in NAV[i-1] ? (NAV[i-1] as any).section : null);

            return (
              <div key={item.href}>
                {showSection && <SectionLabel className="mt-3">{(item as any).section}</SectionLabel>}
                <Link
                  href={item.href}
                  onClick={closeSidebar}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color:      active ? 'var(--accent)' : 'var(--text-2)',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <item.icon className="w-[15px] h-[15px] flex-shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="flex-1">{item.label}</span>
                  {'badge' in item && item.badge && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--emerald-dim)', color: 'var(--emerald)', border: '1px solid var(--emerald-border)' }}>
                      {item.badge}
                    </span>
                  )}
                  {'proBadge' in item && item.proBadge && isFree && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>
                      PRO
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => { router.push('/profile'); closeSidebar(); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors duration-200 text-left"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,var(--violet),var(--gold))', color: '#fff' }}
            >
              {avatar}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{name}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{planLabel} plan</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ── Main ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen lg:pl-56">
        {/* Ambient atmosphere matching the landing, toned down */}
        <div className="app-ambient lg:left-56">
          <div className="app-orb app-orb-violet" />
          <div className="app-orb app-orb-gold" />
          <div className="app-grid" />
        </div>

        {/* Topbar */}
        <header
          className="sticky top-0 z-30 h-14 flex items-center justify-between px-5 border-b backdrop-blur-xl"
          style={{ background: 'var(--nav-bg)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-2)' }}
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <span className="text-sm font-semibold hidden sm:block" style={{ color: 'var(--text-1)' }}>
              {PAGE_TITLES[pathname] ?? 'SpeakSmart'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <IconBtn onClick={toggleTheme} title="Toggle theme">
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </IconBtn>
            <IconBtn onClick={handleLogout} title="Sign out">
              <LogOut className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        </header>

        <main className="flex-1 relative z-[1]">
          {children}
        </main>
      </div>
    </div>
  );
}

function IconBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-9 h-9 flex items-center justify-center rounded-lg border transition-colors duration-200"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      {...props}
    >
      {children}
    </button>
  );
}
