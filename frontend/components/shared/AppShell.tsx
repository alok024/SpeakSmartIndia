'use client';

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

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Practice' },
  { href: '/interview/setup', label: 'New Interview', icon: Play, section: null },
  { href: '/english', label: 'English Practice', icon: MessageSquare, section: null, badge: 'NEW' },
  { href: '/history', label: 'Past Sessions', icon: History, section: null, proBadge: true },
  { href: '/profile', label: 'Profile & Plan', icon: User, section: null },
  { href: '/referral', label: 'Refer & Earn', icon: Gift, section: null, freeOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, closeSidebar, toggleSidebar, isDark, toggleTheme } =
    useUIStore();
  const { user } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();

  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');

  const planLabel =
    user?.plan === 'elite' ? '◈ Elite plan' :
    user?.plan === 'pro' ? '✦ Pro plan' : 'Free plan';

  const name = user?.name || user?.email?.split('@')[0] || '?';
  const avatar = name[0].toUpperCase();

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  return (
    <div className={cn('flex min-h-screen', isDark ? 'dark' : '')} style={{ background: '#0C0A10' }}>
      {/* ── Sidebar ────────────────────────────────── */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full z-50 w-[220px] flex flex-col',
          'border-r transition-transform duration-250',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
        style={{ background: '#141118', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        {/* Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-4 py-4 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.07)' }}
          onClick={closeSidebar}
        >
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" className="flex-shrink-0">
            <circle cx="15" cy="15" r="14" fill="rgba(249,115,22,0.12)" stroke="rgba(249,115,22,0.3)" strokeWidth="0.5"/>
            <rect x="11" y="7" width="8" height="12" rx="4" fill="#F97316"/>
            <path d="M9 16.5C9 19.8 11.7 22.5 15 22.5S21 19.8 21 16.5" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="15" y1="22.5" x2="15" y2="25" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="12" y1="25" x2="18" y2="25" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-sm font-bold" style={{ color: '#F5F3FF', letterSpacing: '-0.02em' }}>
            Speak<span style={{ color: '#F97316' }}>Smart</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2.5">
          {NAV_ITEMS.map((item, i) => {
            const prev = NAV_ITEMS[i - 1];
            const showSection = item.section && item.section !== prev?.section;
            if (item.freeOnly && !isFree) return null;
            const isActive = pathname === item.href;

            return (
              <div key={item.href}>
                {showSection && (
                  <SectionLabel className="mt-3">{item.section}</SectionLabel>
                )}
                <Link
                  href={item.href}
                  onClick={closeSidebar}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-sm font-medium mb-0.5 transition-all"
                  style={{
                    background: isActive ? 'rgba(249,115,22,0.12)' : 'transparent',
                    color: isActive ? '#F97316' : '#9490A8',
                  }}
                >
                  {/* dot indicator */}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: 'currentColor' }}
                  />
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto text-[9px] font-bold text-white rounded px-1 py-0.5"
                      style={{ background: '#F97316' }}>
                      {item.badge}
                    </span>
                  )}
                  {item.proBadge && isFree && (
                    <span className="ml-auto text-[9px] font-bold rounded px-1 py-0.5"
                      style={{ background: 'rgba(255,255,255,0.08)', color: '#9490A8' }}>
                      PRO
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* User chip */}
        <div className="p-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <button
            onClick={() => { router.push('/profile'); closeSidebar(); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] transition-all"
            style={{ color: '#F5F3FF' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(249,115,22,0.3), rgba(139,92,246,0.3))',
                color: '#F5F3FF',
              }}
            >
              {avatar}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: '#F5F3FF' }}>{name}</div>
              <div className="text-[10px]" style={{ color: '#5C5770' }}>{planLabel}</div>
            </div>
          </button>
        </div>
      </aside>

      {/* ── Sidebar overlay (mobile) ────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ── Main content ────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:pl-[220px] min-h-screen" style={{ background: '#0C0A10' }}>
        {/* Topbar */}
        <header
          className="sticky top-0 z-30 h-12 flex items-center justify-between px-5 border-b backdrop-blur"
          style={{ background: 'rgba(12,10,16,0.85)', borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
              style={{ color: '#9490A8' }}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="text-sm font-semibold hidden sm:block" style={{ color: '#F5F3FF' }}>
              {getPageTitle(pathname)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className="w-10 h-10 flex items-center justify-center rounded-lg border transition-colors"
              style={{ border: '0.5px solid rgba(255,255,255,0.07)', color: '#9490A8', background: 'transparent' }}
              title="Toggle theme"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleLogout}
              className="w-10 h-10 flex items-center justify-center rounded-lg border transition-colors"
              style={{ border: '0.5px solid rgba(255,255,255,0.07)', color: '#9490A8', background: 'transparent' }}
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function getPageTitle(pathname: string): string {
  const map: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/interview/setup': 'New Interview',
    '/interview/session': 'Interview',
    '/interview/summary': 'Session Report',
    '/english': 'English Practice',
    '/history': 'Past Sessions',
    '/profile': 'Profile & Plan',
    '/referral': 'Refer & Earn',
  };
  return map[pathname] ?? 'SpeakSmart';
}
