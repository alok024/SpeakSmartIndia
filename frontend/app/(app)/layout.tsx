import { AppShell } from '@/components/shared/AppShell';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
