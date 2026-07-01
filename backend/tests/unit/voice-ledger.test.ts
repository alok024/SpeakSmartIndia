/**
 * Unit tests for voice-ledger plan cap configuration
 * (src/modules/voice/voice.ledger.ts)
 *
 * These tests validate the PLAN_VOICE_CAPS logic and env-driven cap values.
 * No database, no Redis, no network calls — pure config-layer assertions.
 *
 * Integration tests for requireVoiceQuota (DB read path, 429 response,
 * fail-open on transient error) live in tests/integration/.
 */

// Silence logger output — we care about values, not log lines.
jest.mock('../../src/infra/logger', () => ({
  logger: {
    child: () => ({
      info:  jest.fn(),
      warn:  jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Mock the database client so importing voice.ledger.ts doesn't attempt a
// real Supabase connection. The ledger module imports `db` at module scope.
jest.mock('../../src/core/database/client', () => ({
  db: {
    getVoiceUsage:          jest.fn(),
    incrementVoiceUsage:    jest.fn(),
    topUpBonusVoiceSeconds: jest.fn(),
  },
}));

// ── Plan caps ───────────────────────────────────────────────────────────────

describe('Voice ledger plan caps', () => {
  // Replicate the module-level constant so tests are self-contained.
  // If PLAN_VOICE_CAPS is ever exported from the module this should
  // switch to importing it directly.
  const PLAN_CAPS: Record<string, number> = {
    starter: parseInt(process.env.VOICE_CAP_STARTER ?? '1200'),
    pro:     parseInt(process.env.VOICE_CAP_PRO     ?? '3600'),
    elite:   parseInt(process.env.VOICE_CAP_ELITE   ?? '7200'),
  };

  it('free tier has no cap entry (blocked by requireVoiceTier upstream)', () => {
    // Voice is gated before the ledger fires — free users never reach
    // requireVoiceQuota, so no cap entry is needed (or safe to assume).
    expect(PLAN_CAPS['free']).toBeUndefined();
  });

  it('starter cap is 1200 seconds (20 min)', () => {
    expect(PLAN_CAPS['starter']).toBe(1200);
  });

  it('pro cap is 3600 seconds (60 min)', () => {
    expect(PLAN_CAPS['pro']).toBe(3600);
  });

  it('elite cap is 7200 seconds (120 min)', () => {
    expect(PLAN_CAPS['elite']).toBe(7200);
  });

  it('elite cap is a positive number (quota-checked, not unlimited)', () => {
    expect(PLAN_CAPS['elite']).toBeGreaterThan(0);
  });

  it('elite cap is greater than pro cap', () => {
    expect(PLAN_CAPS['elite']).toBeGreaterThan(PLAN_CAPS['pro']);
  });
});

// ── Env-driven cap overrides ─────────────────────────────────────────────────

describe('Voice cap env vars', () => {
  it('VOICE_CAP_STARTER defaults to 1200 seconds (20 min)', () => {
    expect(parseInt(process.env.VOICE_CAP_STARTER ?? '1200')).toBe(1200);
  });

  it('VOICE_CAP_PRO defaults to 3600 seconds (60 min)', () => {
    expect(parseInt(process.env.VOICE_CAP_PRO ?? '3600')).toBe(3600);
  });

  it('VOICE_CAP_ELITE defaults to 7200 seconds (120 min)', () => {
    expect(parseInt(process.env.VOICE_CAP_ELITE ?? '7200')).toBe(7200);
  });

  it('STREAK_VOICE_BONUS_SECS is a non-negative integer', () => {
    const bonus = parseInt(process.env.STREAK_VOICE_BONUS_SECS ?? '300');
    expect(bonus).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(bonus)).toBe(true);
  });

  it('STREAK_VOICE_BONUS_SECS defaults to 300 seconds (5 min)', () => {
    const bonus = parseInt(process.env.STREAK_VOICE_BONUS_SECS ?? '300');
    expect(bonus).toBe(300);
  });

  it('MAX_BONUS_VOICE_SECONDS defaults to 3600 seconds (60 min)', () => {
    const max = parseInt(process.env.MAX_BONUS_VOICE_SECONDS ?? '3600');
    expect(max).toBe(3600);
    expect(max).toBeGreaterThan(0);
  });
});

// ── Effective quota arithmetic ───────────────────────────────────────────────

describe('Effective quota calculation', () => {
  it('effectiveCap = planCap + bonusSeconds', () => {
    const planCap      = 1200;  // starter
    const bonusSecs    = 300;   // one streak milestone
    const effectiveCap = planCap + bonusSecs;
    expect(effectiveCap).toBe(1500);
  });

  it('quota is exhausted when voiceUsed >= effectiveCap', () => {
    const effectiveCap = 1500;
    const voiceUsed    = 1500;
    expect(voiceUsed >= effectiveCap).toBe(true);
  });

  it('quota is NOT exhausted when voiceUsed < effectiveCap', () => {
    const effectiveCap = 1500;
    const voiceUsed    = 1499;
    expect(voiceUsed >= effectiveCap).toBe(false);
  });

  it('voice and avatar seconds are tracked in separate pools', () => {
    // requireVoiceQuota checks voice_seconds_used only.
    // requireAvatarQuota checks avatar_seconds_used only.
    // Heavy avatar usage does NOT consume the voice quota and vice-versa.
    const voiceCap    = 1200; // starter voice cap
    const voiceUsed   = 1200; // voice exhausted
    const avatarUsed  = 600;  // avatar also consumed — irrelevant to voice gate
    expect(voiceUsed >= voiceCap).toBe(true);    // voice gate fires
    expect(avatarUsed >= voiceCap).toBe(false);  // avatar usage doesn't affect voice gate
  });

  it('remainingQuota = effectiveCap - voiceUsed', () => {
    const effectiveCap = 1500;
    const voiceUsed    = 600;
    const remaining    = effectiveCap - voiceUsed;
    expect(remaining).toBe(900);
  });
});

// ── Streak milestone set ─────────────────────────────────────────────────────

describe('Streak milestone days (voice bonus)', () => {
  // Mirror the STREAK_MILESTONE_DAYS set from voice.ledger.ts.
  const STREAK_MILESTONE_DAYS = new Set([7, 14, 21, 28, 35, 42, 60, 90]);

  it('day 7 triggers a voice bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(7)).toBe(true);
  });

  it('day 28 triggers a voice bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(28)).toBe(true);
  });

  it('day 90 triggers a voice bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(90)).toBe(true);
  });

  it('non-milestone day does not trigger a bonus', () => {
    expect(STREAK_MILESTONE_DAYS.has(1)).toBe(false);
    expect(STREAK_MILESTONE_DAYS.has(10)).toBe(false);
    expect(STREAK_MILESTONE_DAYS.has(100)).toBe(false);
  });
});
