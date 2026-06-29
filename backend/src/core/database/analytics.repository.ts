import { AppError } from '../utils/errors';
import { sb } from './base';
import type { AnalyticsEventRow, DailyQuestionRow } from './base';

export const analyticsRepo = {

  // Analytics events

  async createAnalyticsEvents(events: AnalyticsEventRow[]): Promise<void> {
    if (!events.length) return;
    await sb(`/analytics_events`, 'POST', events);
  },

  async createAnalyticsEvent(event: AnalyticsEventRow): Promise<void> {
    await sb(`/analytics_events`, 'POST', event);
  },

  /**
   * Funnel summary: counts of each event name in [sinceIso, now],
   * plus distinct user count per event (drop-off analysis).
   */
  async getEventCounts(sinceIso: string, eventNames?: string[]): Promise<Array<{ event: string; count: number }>> {
    const filter = eventNames?.length
      ? `&event=in.(${eventNames.map(e => encodeURIComponent(e)).join(',')})`
      : '';
    const { data } = await sb<AnalyticsEventRow[]>(
      `/analytics_events?created_at=gte.${sinceIso}&select=event${filter}`
    );
    const counts = new Map<string, number>();
    for (const row of data || []) {
      counts.set(row.event, (counts.get(row.event) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([event, count]) => ({ event, count }));
  },

  async getRecentEvents(limit = 100, eventName?: string, userId?: string): Promise<AnalyticsEventRow[]> {
    let query = `/analytics_events?select=*&order=created_at.desc&limit=${limit}`;
    if (eventName) query += `&event=eq.${encodeURIComponent(eventName)}`;
    // encodeURIComponent prevents URL injection if userId ever comes
    // from an unvalidated source (e.g. a future query-param path).
    if (userId)    query += `&user_id=eq.${encodeURIComponent(userId)}`;
    const { data } = await sb<AnalyticsEventRow[]>(query);
    return data || [];
  },

  // Daily Question Drop

  /** date must be 'YYYY-MM-DD' (IST calendar day — see daily-question.service.ts) */
  async getDailyQuestion(date: string): Promise<DailyQuestionRow | null> {
    const { data } = await sb<DailyQuestionRow[]>(`/daily_questions?date=eq.${date}&select=*`);
    return data?.[0] ?? null;
  },

  /**
   * Race-safe "create if missing": two concurrent first-readers for the
   * same day can both attempt this insert. The `date` PK rejects the
   * second one (POST returns ok=false on conflict, no exception thrown
   * by `sb()`), so the loser just reads back whatever the winner wrote.
   */
  async createDailyQuestionIfMissing(date: string, question: string, profession: string): Promise<DailyQuestionRow> {
    const { ok, data } = await sb<DailyQuestionRow[]>(
      '/daily_questions',
      'POST',
      { date, question, profession },
    );
    if (ok && data?.[0]) return data[0];

    // Lost the race (or any other insert failure) — read back whatever's there.
    const { data: _dqData } = await sb<DailyQuestionRow[]>(`/daily_questions?date=eq.${date}&select=*`);
    const existing = _dqData?.[0] ?? null;
    if (existing) return existing;
    throw new AppError(500, 'db_daily_question_failed', 'Failed to create or read daily question');
  },

  
};

