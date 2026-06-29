'use client';

/**
 * app/(app)/admin/layout.tsx
 *
 * Admin-only guard for the whole /admin section.
 *
 * Previously requireAdmin was applied inside page.tsx, nested inside the
 * (app)/layout.tsx's own ProtectedRoute — meaning every admin page render
 * mounted two ProtectedRoute instances and ran the redirect-check effect
 * twice. Moving the admin guard up to a layout means it runs once, applies
 * automatically to any future /admin/* sub-pages, and keeps page.tsx
 * focused on the dashboard UI instead of auth plumbing.
 */

import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireAdmin>{children}</ProtectedRoute>;
}
