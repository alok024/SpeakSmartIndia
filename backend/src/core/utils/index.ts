// ─── Domain types ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  created_at: string;
}

export interface EmailVerificationToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface EmailVerificationSend {
  id: string;
  user_id: string;
  sent_at: string;
}

// ─── Service return types ─────────────────────────────────────────────────────

export interface VerifyTokenResult {
  success: boolean;
  message: string;
}

// ─── Request body shapes ──────────────────────────────────────────────────────

export interface SignupBody {
  email?: string;
  password?: string;
}

export interface LoginBody {
  email?: string;
  password?: string;
}

export interface VerifyEmailBody {
  token?: string;
}

export interface ResendVerificationBody {
  email?: string;
}

// ─── JWT payload ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

// ─── Prompt-injection defence ─────────────────────────────────────────────────
// Strip common override patterns from user-supplied strings before they are
// concatenated into a system prompt. Not a complete defence on its own — the
// model's own instruction-following and the fixed system prompt are the primary
// controls — but this removes the most obvious low-effort injection attempts.

export function sanitiseTopic(raw: string | undefined): string {
  if (!raw) return 'General';
  return raw
    .replace(/ignore\s+(previous|prior|all)\s+instructions?/gi, '')
    .replace(/you\s+are\s+now\s+/gi, '')
    .replace(/\bsystem\s*:/gi, '')
    .replace(/\[INST\]/gi, '')
    .replace(/<<SYS>>/gi, '')
    .slice(0, 200)
    .trim() || 'General';
}
