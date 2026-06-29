import { env } from '../config/env';
import { sb } from './base';
import type { SubscriptionRow, TokenBlacklistRow } from './base';

export const subscriptionsRepo = {

  // Subscriptions

  async createSubscription(input: Omit<SubscriptionRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/subscriptions', 'POST', input);
  },

  async getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&order=created_at.desc&limit=1&select=*`
    );
    return data?.[0] ?? null;
  },

  async getSubscriptionByPaymentId(paymentId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?razorpay_payment_id=eq.${encodeURIComponent(paymentId)}&select=*`
    );
    return data?.[0] ?? null;
  },

  async updateSubscription(id: string, updates: Partial<SubscriptionRow>): Promise<void> {
    await sb(`/subscriptions?id=eq.${encodeURIComponent(id)}`, 'PATCH', updates);
  },

  /**
   * a renewal-before-expiry previously left the OLD active row
   * in place alongside the new one, so the hourly expiry cron could later
   * downgrade the user back to free based on the stale row even though a
   * newer active subscription existed. Mark every other active row for
   * this user as 'superseded' so at most one 'active' row exists per user.
   */
  async supersedeOtherActiveSubscriptions(userId: string, keepOrderId: string): Promise<void> {
    await sb(
      `/subscriptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&razorpay_order_id=neq.${encodeURIComponent(keepOrderId)}`,
      'PATCH',
      { status: 'superseded' }
    );
  },

  async getExpiredActiveSubscriptions(): Promise<SubscriptionRow[]> {
    const now = new Date().toISOString();
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?status=eq.active&expires_at=lt.${now}&select=*`
    );
    return data ?? [];
  },

  // Token blacklist

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const { data } = await sb<TokenBlacklistRow[]>(
      `/token_blacklist?token_jti=eq.${encodeURIComponent(jti)}&select=token_jti`
    );
    return !!(data && data.length > 0);
  },

  async blacklistToken(input: TokenBlacklistRow): Promise<void> {
    await sb('/token_blacklist', 'POST', input);
  },

  // Prune expired blacklist tokens (run nightly)
  // Without this, the table grows forever and isTokenBlacklisted()
  // gets slower with every logout/refresh.
  async cleanupExpiredBlacklistTokens(): Promise<void> {
    const now = new Date().toISOString();
    await sb(`/token_blacklist?expires_at=lt.${now}`, 'DELETE');
  },

  // Prune expired score_comparisons and their responses (run nightly).
  // The 7-day TTL is enforced at read time in the controller, but rows
  // are never deleted — the table grows forever without this job.
  // Deleting the parent cascades to comparison_responses via FK ON DELETE CASCADE.
  async cleanupExpiredComparisons(): Promise<void> {
    const now = new Date().toISOString();
    await sb(`/score_comparisons?expires_at=lt.${now}`, 'DELETE');
  },

  
};

