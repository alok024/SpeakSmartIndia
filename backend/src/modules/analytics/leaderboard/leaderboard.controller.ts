import { Request, Response } from 'express';
import { asyncHandler } from '../../../core/middleware';
import { db } from '../../../core/database/client';
import { ok } from '../../../core/utils/response';

// GET /api/leaderboard
//
// Weekly XP leaderboard (resets every Sunday midnight IST).
// Only Pro and Elite users appear in the ranked list — Free/Starter users
// get their own position + a "locked" flag so the frontend can show a blur/upsell.
//
// Lazy weekly reset: if the most recent Sunday midnight IST has passed since
// the last reset (read from the first stats row), we fire reset_weekly_xp()
// fire-and-forget before returning the board.  The reset is idempotent and
// the single-session lag is acceptable for a leaderboard that is not real-time.
export const getLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  const userId   = req.user!.id;
  const userPlan = req.user!.plan as string;
  const LIMIT    = 50;

  // Lazy weekly reset guard (same pattern as monthly XP reset in sessions.service.ts)
  const myStats = await db.getStats(userId);
  const weekResetAt = myStats?.xp_weekly_reset_at ? new Date(myStats.xp_weekly_reset_at) : null;
  const nowIST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dayOfWeek  = nowIST.getDay();               // 0=Sunday
  const lastSunday = new Date(nowIST);
  lastSunday.setDate(nowIST.getDate() - dayOfWeek);
  lastSunday.setHours(0, 0, 0, 0);
  if (!weekResetAt || weekResetAt < lastSunday) {
    db.resetWeeklyXp().catch(() => { /* non-fatal */ });
  }

  // leaderboard_weekly view only contains Pro + Elite users
  const board = await db.getLeaderboard(LIMIT);

  // Is the calling user in the competitive pool?
  const isCompetitive = userPlan === 'pro' || userPlan === 'elite';

  // Caller's position
  const myEntry          = board.find(e => e.user_id === userId);
  const myRank           = myEntry?.rank ?? null;
  const myXpWeekly       = myEntry?.xp_weekly       ?? (myStats?.xp_weekly   ?? 0);
  const myXpLife         = myEntry?.xp_lifetime      ?? (myStats?.xp_lifetime ?? 0);
  const myStreak         = myEntry?.streak            ?? (myStats?.streak      ?? 0);

  // Strip internal user_id from board entries
  const entries = board.map(({ user_id: _uid, ...rest }) => rest);

  ok(res, {
    entries,
    me: {
      rank:            myRank,
      xp_weekly:       myXpWeekly,
      xp_lifetime:     myXpLife,
      streak:          myStreak,
      in_top_50:       myEntry != null,
      is_competitive:  isCompetitive,  // false → frontend shows blur/upsell
    },
    resets_next_sunday: true,  // static hint for the frontend label
  });
});
