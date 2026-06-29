import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { sb } from './base';
import type { UserRow, SubscriptionRow, SessionRow, B2BLeadRow } from './base';
import type { LeadDTO } from '../utils/schemas';

export const adminRepo = {

  // Admin: users

  async getUserCount(): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/users?select=id`, {
      method:  'HEAD',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getUsersPage(
    limit: number,
    offset: number,
    search?: string
  ): Promise<{ users: UserRow[]; total: number }> {
    let path = `/users?select=id,email,name,plan,email_verified,onboarding_profession,onboarding_goal,onboarding_completed_at,referral_bonus,created_at&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (search) {
      path += `&email=ilike.*${encodeURIComponent(search)}*`;
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
      method:  'GET',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const raw   = await res.text();
    const data  = (raw ? JSON.parse(raw) : []) as UserRow[];
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];

    return { users: data, total: total ? parseInt(total, 10) : data.length };
  },

  async getPlanCounts(): Promise<Record<string, number>> {
    const plans = ['free', 'starter', 'pro', 'elite'];
    const counts: Record<string, number> = {};

    await Promise.all(plans.map(async (plan) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/users?plan=eq.${plan}&select=id`, {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      });
      const range = res.headers.get('content-range');
      const total = range?.split('/')[1];
      counts[plan] = total ? parseInt(total, 10) : 0;
    }));

    return counts;
  },

  async getOnboardingStats(): Promise<{ total: number; completed: number }> {
    const totalRes = await fetch(`${env.SUPABASE_URL}/rest/v1/users?select=id`, {
      method:  'HEAD',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const totalRange = totalRes.headers.get('content-range');
    const total = totalRange?.split('/')[1] ? parseInt(totalRange.split('/')[1], 10) : 0;

    const completedRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/users?onboarding_completed_at=not.is.null&select=id`,
      {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      },
    );
    const completedRange = completedRes.headers.get('content-range');
    const completed = completedRange?.split('/')[1]
      ? parseInt(completedRange.split('/')[1], 10)
      : 0;

    return { total, completed };
  },

  // Admin: revenue & subscriptions

  async getActiveSubscriptionCounts(): Promise<Record<string, number>> {
    const plans = ['starter', 'pro', 'elite'];
    const counts: Record<string, number> = {};

    await Promise.all(plans.map(async (plan) => {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/subscriptions?plan=eq.${plan}&status=eq.active&select=id`,
        {
          method:  'HEAD',
          headers: {
            'apikey':        env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Prefer':        'count=exact',
          },
        }
      );
      const range = res.headers.get('content-range');
      const total = range?.split('/')[1];
      counts[plan] = total ? parseInt(total, 10) : 0;
    }));

    return counts;
  },

  async getRecentSubscriptions(limit: number): Promise<SubscriptionRow[]> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // Admin: sessions

  async getSessionCount(): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/sessions?select=id`, {
      method:  'HEAD',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getSessionCountSince(sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/sessions?created_at=gte.${sinceIso}&select=id`,
      {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getNewUserCountSince(sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/users?created_at=gte.${sinceIso}&select=id`,
      {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  // B2B Leads

  async createLead(lead: LeadDTO): Promise<B2BLeadRow> {
    const { data } = await sb<B2BLeadRow[]>(`/b2b_leads`, 'POST', {
      name:     lead.name,
      email:    lead.email,
      org:      lead.org,
      size:     lead.size,
      org_type: lead.orgType || null,
      message:  lead.message || null,
    });
    const row = data?.[0];
    if (!row) throw new AppError(500, 'db_lead_creation_failed', 'Failed to create lead');
    return row;
  },

  async getLeadById(id: string): Promise<B2BLeadRow | null> {
    const { data } = await sb<B2BLeadRow[]>(`/b2b_leads?id=eq.${encodeURIComponent(id)}&select=*`);
    return data?.[0] ?? null;
  },

  /**
   * Paginated, optionally status-filtered list of B2B leads for the
   * admin leads table. Mirrors getUsersPage's count=exact pattern.
   */
  async getLeadsPage(
    limit: number,
    offset: number,
    status?: string
  ): Promise<{ leads: B2BLeadRow[]; total: number }> {
    let path = `/b2b_leads?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (status) {
      path += `&status=eq.${encodeURIComponent(status)}`;
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
      method:  'GET',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const raw   = await res.text();
    const data  = (raw ? JSON.parse(raw) : []) as B2BLeadRow[];
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];

    return { leads: data, total: total ? parseInt(total, 10) : data.length };
  },

  /**
   * Updates a lead's status, but only if it's still in `fromStatus`.
   * Used by the 24h follow-up job so a lead the team has already
   * contacted/qualified/closed isn't silently reset back to "contacted".
   * Returns true if the row was updated.
   */
  async updateLeadStatus(id: string, toStatus: string, fromStatus?: string): Promise<boolean> {
    const filter = fromStatus
      ? `/b2b_leads?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}`
      : `/b2b_leads?id=eq.${encodeURIComponent(id)}`;
    const { data } = await sb<B2BLeadRow[]>(filter, 'PATCH', { status: toStatus });
    return (data?.length ?? 0) > 0;
  },
};

