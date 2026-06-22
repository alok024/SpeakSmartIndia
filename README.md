<div align="center">
  <br />
  <img src="public/vachix-logo.svg" alt="Vachix" height="48" />
  <br /><br />

  <p><strong>AI interview coach and English fluency trainer for India's competitive exam and placement market.</strong></p>

  <p>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js_15-000000?style=flat-square&logo=next.js&logoColor=white" />
    <img alt="Express" src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white" />
    <img alt="BullMQ" src="https://img.shields.io/badge/BullMQ-FF0000?style=flat-square&logo=redis&logoColor=white" />
    <img alt="Razorpay" src="https://img.shields.io/badge/Razorpay-02042B?style=flat-square&logo=razorpay&logoColor=white" />
  </p>

  <p>
    <img alt="Status" src="https://img.shields.io/badge/status-pre--launch-yellow?style=flat-square" />
    <img alt="tsc" src="https://img.shields.io/badge/tsc-0_errors-brightgreen?style=flat-square" />
    <img alt="Migrations" src="https://img.shields.io/badge/migrations-13-blue?style=flat-square" />
  </p>
</div>

---

## Overview

Vachix pairs users with two AI personas — **Aria** (interview coach) and **Elara** (English fluency trainer) — to run realistic spoken interview simulations, then scores each session across fluency, grammar, and vocabulary. It's built for India's B2C market: UPSC, Bank PO, SSC, and campus placements, with native-accent Hindi/Hinglish/English voice via Sarvam AI.

The codebase is a TypeScript monorepo: Next.js 15 frontend, Express backend, shared Zod schemas, and a BullMQ worker — all built to production standards with auth, billing, analytics, and a background job pipeline in place before launch.

---

## Feature Surface

### Interview Practice
| Feature | Detail |
|---|---|
| **AI Interview Simulation** | Streaming role-play across 11+ tracks (UPSC, Bank PO, SSC CGL, campus, MNC, startup). Adaptive difficulty adjusts pacing and feedback depth based on session history. |
| **English Correction (Elara)** | Real-time grammar, tense, and fluency corrections mid-conversation. Separate persona from the interview coach. |
| **Scored Session Feedback** | Every session scored on fluency, grammar, and vocabulary. Weak areas aggregated over time and surfaced on the dashboard. |
| **Multi-Language Mode** | Interview in English, Hindi, or Hinglish. Sarvam TTS renders native-accent audio across all three. |
| **"Stuck? Get a Hint"** | One-tap mid-session nudge toward STAR structure. Unmetered — does not count against the session quota. |

### Voice
| Feature | Detail |
|---|---|
| **HD Voice Coaching** | Sarvam AI primary TTS; automatic failover to ElevenLabs via a Redis-backed circuit breaker (closed → open → half-open probe). Pays zero per-request fallback cost during a real Sarvam outage. |
| **Voice Warm-Up** | 30-second HD voice sample available on the Free tier, once per IST day, gated via Redis. Lets free users hear the quality before upgrading. |
| **Per-Cycle Voice Ledger** | New DB table tracks seconds consumed per user per billing cycle. Gate-checked before every TTS call. Milestone bonuses top up the ledger non-fatally (failure never blocks the session result). |

### Progress & Retention
| Feature | Detail |
|---|---|
| **Interviewer's Notes** | Post-session async job (BullMQ) generates a 2–3 sentence AI narrative pinpointing the single biggest fix — distinct from raw scores. |
| **Interview Readiness Report** | Auto-generated every 5 sessions. Aggregates scores, notes, and weak areas. Gated Starter+. Shareable via signed link. |
| **Readiness Certificate** | Branded shareable image generated at performance thresholds. Cryptographically signed — tamper-proof. LinkedIn/WhatsApp ready. |
| **Friend Score Comparison** | Async share link: recipient attempts the same question, scores compared side-by-side. No live pairing, no scheduling. |
| **Daily Question Drop** | Fresh question each day on the dashboard, drawn from the user's active track. |
| **Streak Milestones** | Streaks tracked in IST. Day 7 / 14 / 21 / ... milestones top up the voice ledger as a reward. Same "bonus pool" shape as the referral system. |

### Growth & Monetisation
| Feature | Detail |
|---|---|
| **Referral System** | Unique per-user code. Inviter earns 10 bonus AI sessions when invitee completes first session. Bonus capped at 50 sessions, enforced atomically in the DB (not in app code). |
| **Subscription Billing** | Four-tier plans, Razorpay-powered, webhook-verified activation. Plan limits enforced server-side; frontend never owns the source of truth. |
| **B2B Lead Capture** | Rate-limited lead-intake endpoint with automated Resend email follow-ups and BullMQ-deferred scheduling. |
| **Admin Dashboard** | Internal overview of users, plans, session counts, and lead funnel. Role gated against the DB on every request — JWT claim alone is never trusted. |

---

## Architecture

```
┌──────────────────────┐       /api/* rewrite (same-origin)      ┌──────────────────────┐
│     Next.js 15       │ ─────────────────────────────────────►  │     Express API       │
│     App Router       │ ◄─────── httpOnly JWT cookies ────────  │     TypeScript        │
└──────────────────────┘                                          └──────────────────────┘
         │                                                                   │
         │ Edge middleware                         ┌─────────────────────────┼──────────────────────┐
         │ (auth gate)                             ▼                         ▼                      ▼
         │                               ┌──────────────────┐    ┌──────────────────┐   ┌──────────────────┐
         │                               │     Supabase     │    │   Groq / OpenAI  │   │    Razorpay      │
         │                               │  Postgres + RLS  │    │  AI inference    │   │    Payments      │
         │                               │  13 migrations   │    │  circuit breaker │   └──────────────────┘
         │                               └──────────────────┘    └──────────────────┘
         │                                                                   │
         └──────────────────────────────────────────────────────────────────┤
                                                                            ▼
                                                               ┌──────────────────────┐
                                                               │   Sarvam AI (TTS)    │
                                                               │   + ElevenLabs (FB)  │
                                                               │   Redis circuit CB   │
                                                               ├──────────────────────┤
                                                               │   BullMQ + Redis     │
                                                               │   Background jobs    │
                                                               └──────────────────────┘
```

**Auth:** Short-lived JWT access tokens + rotating refresh tokens, both in `httpOnly` cookies. The frontend's JavaScript never touches a raw token. The Next.js app proxies `/api/*` to the backend so cookies stay same-origin regardless of deployment topology.

**AI failover:** Groq is the primary inference provider. If a Groq call fails, the circuit breaker routes to OpenAI. Both providers share the same request/response shape — swapping is a one-line config change.

**Voice failover:** Sarvam AI is the primary TTS provider. A Redis-backed circuit breaker (3-failure threshold, 15s cooldown) promotes ElevenLabs to primary when Sarvam is down, and demotes it the moment Sarvam recovers — via a single half-open probe.

---

## Tech Stack

**Frontend**
- Next.js 15 (App Router) + React 18 + TypeScript
- TanStack Query v5 — server state, cache invalidation, optimistic updates
- Zustand — client state (auth session, interview state, UI)
- Tailwind CSS + shadcn/ui
- Zod — shared validation schemas (imported from `@vachix/shared`)
- Cloudflare Pages deployment target (Wrangler)

**Backend**
- Express + TypeScript, strict mode, zero `any`
- Supabase (Postgres + Row Level Security) — 13 migrations, RLS default-deny
- BullMQ + Redis — background jobs: Interviewer's Notes, report generation, transactional emails, subscription/session expiry
- Razorpay — order creation, webhook-verified plan activation
- Groq (primary) / OpenAI (fallback) — AI inference, circuit-breaker failover
- Sarvam AI (primary TTS) / ElevenLabs (fallback TTS) — Redis-backed circuit breaker
- Resend — transactional email (verification, follow-ups, referral notifications)
- Winston + Sentry — structured logging and error tracking
- Railway deployment target

**Shared**
- `@vachix/shared` — Zod schemas and TypeScript types consumed by both apps. Single source of truth for API contracts.

---

## Project Structure

```
vachix/
├── frontend/                         Next.js 15
│   ├── app/
│   │   ├── (auth)/                   Login · Register · Password reset · Email verify
│   │   ├── (app)/                    Dashboard · Interview · History · Profile · Admin
│   │   └── (public)/                 Certificate · Compare · Report  ← unauthenticated share targets
│   ├── components/
│   │   ├── shared/                   AppShell · UpgradeModal · ErrorBoundary · ProtectedRoute
│   │   └── ui/                       shadcn/ui wrappers
│   ├── features/                     Feature-scoped: API client · hooks · types
│   │   ├── ai/                       Hint · daily question
│   │   ├── certificates/
│   │   ├── comparison/               Friend score share links
│   │   ├── interview/                Session · scoring · multi-language setup
│   │   ├── payment/                  Plan upgrade flow
│   │   ├── reports/                  Readiness Report
│   │   └── voice/                    TTS · warm-up
│   ├── store/                        Zustand: auth · interview · ui
│   ├── lib/                          API client · query keys · utils
│   └── middleware.ts                 Edge auth gate (all /app/* routes)
│
├── backend/
│   └── src/
│       ├── app.ts                    Entry: security headers · CORS · route mounting
│       ├── core/
│       │   ├── config/env.ts         Zod-validated env — process exits on missing required vars
│       │   ├── database/client.ts    Supabase client
│       │   └── middleware.ts         JWT auth · plan checks · rate limiting
│       ├── infra/
│       │   ├── queue/                BullMQ queues · dispatcher · worker
│       │   ├── circuit-breaker.ts    AI provider failover (Groq → OpenAI)
│       │   ├── sarvam-circuit-breaker.ts   TTS provider failover (Sarvam → ElevenLabs)
│       │   ├── burst-limiter.ts      Per-route Redis rate limiting
│       │   └── observability.ts      Sentry + Winston integration
│       └── modules/
│           ├── ai/                   Interview AI · hint · daily question · adaptive difficulty
│           ├── analytics/            Sessions · events · weak areas · interviewer notes · readiness report
│           ├── auth/                 JWT · refresh tokens · email verification
│           ├── certificates/         Certificate generation + signed verification
│           ├── comparison/           Friend score comparison (async share links)
│           ├── growth/               Referral system
│           ├── payment/              Razorpay order creation + webhook handler
│           ├── reports/              Interview Readiness Report endpoints
│           ├── voice/                TTS (Sarvam → ElevenLabs) · usage ledger · warm-up
│           ├── admin/                Internal dashboard
│           └── user/                 Profile · plan status · usage
│
├── backend/migrations/               13 SQL migrations (apply in order)
└── shared/                           @vachix/shared — Zod schemas + TypeScript types
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project (Postgres)
- Razorpay account (test mode works locally)
- Groq API key (primary AI inference)
- Redis — optional locally; BullMQ jobs run inline without it

### Install

```bash
git clone <repo-url>
cd vachix

# Backend
cd backend && npm install
cp .env.example .env     # fill in required keys — see table below
npm run dev

# Frontend (separate terminal)
cd frontend && npm install
npm run dev
```

Frontend: `http://localhost:3000` — proxies `/api/*` to the backend via `NEXT_PUBLIC_BACKEND_URL`.

### Database

Apply migrations in order against your Supabase project:

```bash
for f in backend/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Or apply the consolidated file at the repo root: `vachix_all_migrations.sql`.

---

## Environment Variables

```bash
cp backend/.env.example backend/.env
```

Required in production — the server refuses to start if any of these are missing:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Database (service role — server-side only) |
| `SUPABASE_ANON_KEY` | RLS-scoped client key (required in production) |
| `JWT_SECRET` + `JWT_REFRESH_SECRET` | Token signing |
| `REPORT_SECRET` | HMAC-SHA256 signing for shareable report and certificate links |
| `GROQ_API_KEY` | Primary AI inference |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET` | Payments |
| `SARVAM_API_KEY` | Primary TTS (Indian-accent voice) |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | Fallback TTS |

Everything else (email, Redis, circuit-breaker thresholds, rate-limit tuning, voice caps) is optional with sensible defaults. See `backend/.env.example` for the full annotated list.

> **Never commit a populated `.env`.** `SUPABASE_SERVICE_KEY` and the Razorpay secret keys grant full backend access.

---

## Plans

| | Free | Starter | Pro | Elite |
|---|:---:|:---:|:---:|:---:|
| **Price** | ₹0 | ₹299/mo | ₹699/mo | ₹1,299/mo |
| **AI Sessions** | 7/month | 30/month | Unlimited | Unlimited |
| **HD Voice** | Warm-up only¹ | 10 min/month | 60 min/month | Unlimited |
| **Interviewer's Notes** | ✓ | ✓ | ✓ | ✓ |
| **Readiness Report** | — | ✓ | ✓ | ✓ |
| **Readiness Certificate** | ✓ | ✓ | ✓ | ✓ |
| **Friend Comparison** | ✓ | ✓ | ✓ | ✓ |

¹ 30-second voice sample, once per day.

---

## Scripts

**Backend** (`/backend`)

| Command | What it does |
|---|---|
| `npm run dev` | API in watch mode |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled build |
| `npm run worker` | BullMQ background worker (run as a separate process in production) |
| `npm test` | Jest test suite |

**Frontend** (`/frontend`)

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |

---

## Security

**Tokens never touch JavaScript.** Access and refresh tokens live in `httpOnly`, `Secure`, `SameSite=Lax` cookies. The frontend cannot read, log, or exfiltrate them — the most common XSS-to-account-takeover path is closed by construction.

**Privilege checks are DB-authoritative.** Admin status, plan tier, and email verification are re-read from the database on every privileged request — never derived from a JWT claim alone. Revocations and downgrades take effect on the next request, not at token expiry.

**Signed public links.** Report and certificate share links are HMAC-SHA256 signed with a server secret. The signature is verified with a constant-time comparison before any data is served — no timing side-channels, no reversible encoding.

**Atomic billing integrity.** Referral bonus caps and voice ledger updates are enforced inside database functions (`LEAST()`, atomic increments) — not in application code that can be raced.

**RLS default-deny.** Migration 008 applies a default-deny Row Level Security policy to all Supabase tables. Policies are explicit allowlists, not ad-hoc exclusions.

**Per-route rate limiting.** Every public or auth-sensitive endpoint (login, register, password reset, TTS warm-up, lead capture, public report fetch) has a Redis-backed rate limiter with independent thresholds.

**Strict CORS allowlist** across all environments, including preview deployments. Set `EXTRA_ALLOWED_ORIGINS` to whitelist staging URLs without a code change.

---

## Deployment

**Frontend → Cloudflare Pages**
```bash
cd frontend && npm run build:cf && npm run deploy
```

**Backend → Railway (or any Node host)**
```bash
npm run build && npm start
# In a separate Railway service:
npm run worker
```

Set `SARVAM_PRIMARY=true` (the default) to use Sarvam as the primary TTS provider. Set to `false` to invert the preference to ElevenLabs-first without touching code.

Set `EXTRA_ALLOWED_ORIGINS` to comma-separated preview URLs to whitelist staging without a redeploy.

---

## Contributing

1. Fork and create a feature branch off `main`.
2. Run `npx tsc --noEmit` in both `/backend` and `/frontend` before pushing — the repo must stay at zero TypeScript errors.
3. Run `npm test` in `/backend`.
4. Open a PR with a clear description of what changed and why. Reference the relevant module if touching backend logic.

---

## License

Proprietary. All rights reserved. Contact the maintainers before reusing any part of this codebase.

---

<div align="center">
  <sub>Built for India's next generation of confident communicators.</sub>
</div>
