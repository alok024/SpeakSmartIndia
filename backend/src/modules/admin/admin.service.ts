import { db, B2BLeadRow } from '../../core/database/client';
import { PLAN_PRICES } from '../../core/config/env';

export interface AdminOverview {
  users: {
    total:      number;
    new_7d:     number;
    new_30d:    number;
    by_plan:    Record<string, number>;
  };
  onboarding: {
    total:     number;
    completed: number;
    rate:      number; // 0-1
  };
  revenue: {
    active_subscriptions: Record<string, number>;
    mrr_paise:            number;
    mrr_inr:              number;
  };
  sessions: {
    total:  number;
    last_7d: number;
    last_30d: number;
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const now = Date.now();
  const since7d  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalUsers,
    new7d,
    new30d,
    byPlan,
    onboardingStats,
    activeSubs,
    sessionsTotal,
    sessions7d,
    sessions30d,
  ] = await Promise.all([
    db.getUserCount(),
    db.getNewUserCountSince(since7d),
    db.getNewUserCountSince(since30d),
    db.getPlanCounts(),
    db.getOnboardingStats(),
    db.getActiveSubscriptionCounts(),
    db.getSessionCount(),
    db.getSessionCountSince(since7d),
    db.getSessionCountSince(since30d),
  ]);

  const mrrPaise =
    (activeSubs.pro   || 0) * PLAN_PRICES.pro +
    (activeSubs.elite || 0) * PLAN_PRICES.elite;

  return {
    users: {
      total:   totalUsers,
      new_7d:  new7d,
      new_30d: new30d,
      by_plan: byPlan,
    },
    onboarding: {
      total:     onboardingStats.total,
      completed: onboardingStats.completed,
      rate:      onboardingStats.total > 0
        ? Math.round((onboardingStats.completed / onboardingStats.total) * 1000) / 1000
        : 0,
    },
    revenue: {
      active_subscriptions: activeSubs,
      mrr_paise: mrrPaise,
      mrr_inr:   Math.round(mrrPaise / 100),
    },
    sessions: {
      total:    sessionsTotal,
      last_7d:  sessions7d,
      last_30d: sessions30d,
    },
  };
}

export interface AdminUsersPage {
  users: Array<{
    id:          string;
    email:       string;
    name:        string;
    plan:        string;
    email_verified: boolean;
    onboarding_completed: boolean;
    onboarding_profession: string | null;
    onboarding_goal: string | null;
    referral_bonus: number;
    created_at: string;
  }>;
  total:  number;
  limit:  number;
  offset: number;
}

export async function getAdminUsers(
  limit: number,
  offset: number,
  search?: string
): Promise<AdminUsersPage> {
  const { users, total } = await db.getUsersPage(limit, offset, search);

  return {
    users: users.map(u => ({
      id:    u.id,
      email: u.email,
      name:  u.name || '',
      plan:  u.plan,
      email_verified: !!u.email_verified,
      onboarding_completed: !!u.onboarding_completed_at,
      onboarding_profession: u.onboarding_profession || null,
      onboarding_goal: u.onboarding_goal || null,
      referral_bonus: u.referral_bonus || 0,
      created_at: u.created_at || '',
    })),
    total,
    limit,
    offset,
  };
}

export async function getAdminRecentSubscriptions(limit: number) {
  return db.getRecentSubscriptions(limit);
}

// B2B Leads

export interface AdminLeadsPage {
  leads:  B2BLeadRow[];
  total:  number;
  limit:  number;
  offset: number;
}

export async function getAdminLeads(
  limit: number,
  offset: number,
  status?: string
): Promise<AdminLeadsPage> {
  const { leads, total } = await db.getLeadsPage(limit, offset, status);
  return { leads, total, limit, offset };
}

/**
 * Admin override — sets a lead's status directly, regardless of its
 * current status (no fromStatus guard). Returns the updated lead, or
 * null if no lead with that id exists.
 */
export async function updateAdminLeadStatus(
  id: string,
  status: string
): Promise<B2BLeadRow | null> {
  const updated = await db.updateLeadStatus(id, status);
  if (!updated) return null;
  return db.getLeadById(id);
}
