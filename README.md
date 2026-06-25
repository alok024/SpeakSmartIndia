<div align="center">

<img src="https://img.shields.io/badge/status-active%20development-brightgreen?style=flat-square" alt="Status" />
<img src="https://img.shields.io/badge/license-proprietary-red?style=flat-square" alt="License" />

# Vachix

**AI-powered interview practice and English coaching for Indian job seekers.**

Two AI coaches. Real interview questions. Live language correction. Built for UPSC, Bank PO, SSC, campus placements, and tech roles.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js%2015-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Express](https://img.shields.io/badge/Express-404D59?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Railway](https://img.shields.io/badge/Railway-0B0D0E?style=flat-square&logo=railway&logoColor=white)](https://railway.app/)

</div>

---

## What it does

Most competitive-exam coaching teaches candidates *what* to say. Nobody trains them on *how* they say it — the grammar slips, the filler phrases, the Hinglish patterns that cost marks in front of a real panel.

Vachix puts two AI coaches in the room:

- **Aria** — fires realistic questions across 11 exam and role tracks (UPSC/IAS, Bank PO, SSC CGL, Railway, Defence, Software Engineering, Data Science, Product Management, Campus Placements, Teaching, Healthcare). Adapts difficulty as readiness scores improve.
- **Elara** — watches every answer in real time and catches grammar errors, incorrect tenses, bureaucratic filler, and Hinglish patterns the moment they appear — not at the end of the session. Scores each answer across Grammar, Fluency, and Vocabulary independently.

Sessions run via text or voice (Web Speech API), feedback is instant, and every session's scores are tracked over time so candidates can see exactly which dimension is holding them back.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Feature Map](#feature-map)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Security Model](#security-model)
- [Deployment](#deployment)
- [Roadmap](#roadmap)

---

## Architecture

```
┌──────────────────────────────┐        /api/* rewrite proxy         ┌──────────────────────────────┐
│   Next.js 15  (App Router)   │ ──────────────────────────────────► │   Express + TypeScript API    │
│   Cloudflare Pages           │ ◄────────── httpOnly cookies ─────── │   Railway                     │
└──────────────────────────────┘                                      └──────────────────────────────┘
                                                                               │
                  ┌────────────────────────────────────┬──────────────────────┼────────────────────────┐
                  ▼                                    ▼                       ▼                        ▼
        ┌──────────────────┐              ┌──────────────────┐     ┌──────────────────┐    ┌──────────────────┐
        │  Supabase        │              │  Groq (primary)  │     │  BullMQ + Redis  │    │  Razorpay        │
        │  Postgres + RLS  │              │  AI inference    │     │  Background jobs │    │  Payments        │
        └──────────────────┘              └──────────────────┘     └──────────────────┘    └──────────────────┘
```

The frontend proxies all `/api/*` traffic to the backend at the edge. This keeps cookies same-origin in the browser regardless of where the API is hosted, and means the frontend never has to manage CORS credentials.

Authentication uses short-lived JWT access tokens and rotating refresh tokens, both stored exclusively in `httpOnly` cookies. Frontend JavaScript never touches a token — this closes the XSS-to-account-takeover path that bearer token setups leave open.

All privileged state (plan, admin status, email verification) is re-validated against the database on every request — never trusted from the JWT claim alone. Revocations and plan downgrades take effect immediately.

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + React 18 + TypeScript |
| Styling | Tailwind CSS + custom CSS (landing animations, theme system) |
| Components | shadcn/ui + Radix UI primitives + Lucide icons |
| Server state | TanStack Query v5 |
| Client state | Zustand (auth, UI, interview session) |
| Validation | Zod (shared schemas with backend via `shared/`) |
| Voice input | Web Speech API with `@ricky0123/vad-web` for voice activity detection |
| Deployment | Cloudflare Pages via `@cloudflare/next-on-pages` |

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + Express + TypeScript |
| Database | Supabase (Postgres + Row Level Security) |
| AI inference | Groq (primary) — llama-3.3-70b-versatile |
| Job queue | BullMQ + Redis (email follow-ups, session/subscription expiry) |
| Payments | Razorpay (webhook-verified plan activation) |
| Email | Resend (transactional — verification, password reset, B2B follow-ups) |
| Logging | Winston + Sentry |
| Deployment | Railway |

---

## Project Structure

```
vachix/
├── frontend/                        Next.js 15 application
│   ├── app/
│   │   ├── layout.tsx               Root layout — theme, query client, auth provider
│   │   ├── (auth)/                  Public auth routes (login, register, reset, verify)
│   │   ├── (app)/                   Protected app shell — dashboard, interview, history, profile
│   │   └── (public)/                Unauthenticated pages (reports, certificates, B2B, terms)
│   ├── components/
│   │   ├── shared/                  AppShell, ProtectedRoute, ErrorBoundary, modals
│   │   ├── landing/                 LandingPage (self-contained — animations, rail, toggles)
│   │   └── ui/                      Base component library (shadcn wrappers)
│   ├── features/                    Vertical feature slices
│   │   ├── auth/                    Login, register, logout, password reset
│   │   ├── user/                    Profile, onboarding, referral, stats
│   │   ├── ai/                      AI chat proxy (interview + English practice)
│   │   ├── certificates/            Certificate generation and retrieval
│   │   └── …                        (analytics, payment, voice, reports)
│   ├── store/
│   │   ├── auth.ts                  User + token state (Zustand)
│   │   ├── ui.ts                    Sidebar, theme, toasts (Zustand)
│   │   └── interview.ts             Active session state
│   ├── lib/
│   │   ├── api.ts                   Core fetch wrapper — auth refresh, error shaping
│   │   └── query-keys.ts            Centralised React Query key registry
│   ├── app/globals.css              App-shell design tokens and component styles
│   ├── app/landing.css              Landing page styles (isolated from app shell)
│   └── middleware.ts                Edge auth gate — redirects unauthenticated requests
│
├── backend/                         Express API
│   └── src/
│       ├── app.ts                   Entry point — middleware stack, routes, error handler
│       ├── core/                    Config, DB client, shared middleware, utils
│       ├── infra/                   BullMQ workers, rate limiters, circuit breakers
│       └── modules/
│           ├── auth/                JWT issuance, refresh, email verification
│           ├── ai/                  Groq inference, prompt construction, quota gating
│           ├── interview/           Session creation, JD-based questions, impromptu mode
│           ├── payment/             Razorpay order creation, webhook verification
│           ├── user/                Profile, onboarding, referral system, streak tracking
│           ├── reports/             HMAC-signed shareable session reports
│           ├── certificates/        Certificate generation
│           ├── analytics/           Score history, session list
│           ├── prep-paths/          Structured exam prep track management
│           ├── voice/               ElevenLabs TTS proxy
│           ├── speech/              Speech processing utilities
│           ├── leads/               B2B lead capture with email follow-up
│           ├── admin/               Internal dashboard — users, subs, lead funnel
│           ├── comparison/          Cross-session comparison views
│           ├── growth/              Referral tracking, bonus session grants
│           └── push/                Push notification infrastructure
│
└── shared/                          Types and Zod schemas shared across frontend + backend
    ├── index.ts
    └── schemas/api.schemas.ts
```

Each `features/<name>/` slice in the frontend owns its own `api/`, `types/`, `hooks/`, and `schemas/` — no shared god-object API client. Adding a new endpoint means touching exactly one feature slice.

---

## Feature Map

### Live and shipped

| Feature | Notes |
|---|---|
| AI interview sessions | Streaming responses, 11 exam/role tracks, adaptive difficulty |
| JD-based questions | Upload a job description, get role-specific interview questions |
| Impromptu practice mode | DB-seeded topic library, quota-gated Groq calls |
| Live English correction (Elara) | Grammar, fluency, vocabulary scored per answer |
| Web Speech API voice input | Real-time transcription with VAD, browser-native, no upload |
| Session history + score tracking | Per-dimension charts, weak-area detection over time |
| Shareable session reports | HMAC-SHA256 signed links, tamper-proof, publicly accessible |
| Certificates | Generated on qualifying sessions |
| Referral system | Unique codes, bonus session grants on verified signup |
| Subscriptions — Free / Starter / Pro / Elite | Razorpay-powered, webhook-verified, instant plan changes |
| Streak tracking | Daily practice streaks with badge in app shell |
| Prep paths | Structured exam-track learning plans |
| B2B lead capture | Rate-limited intake, automated email follow-up via Resend |
| Admin dashboard | User, subscription, and lead funnel overview — DB-role gated |
| Animated day/night toggle | Sun↔moon morph with spring knob, twinkling stars, crescent mask |
| Responsive landing page | Scroll-tracking side rail, parallax, toast system, glass modals |

### In development / coming next

| Feature | Plan tier |
|---|---|
| Upgraded voice recognition (accent-tuned speech engine) | Pro + Elite |
| Elara spoken feedback (audio responses during sessions) | Pro + Elite |
| Pronunciation scoring (word-by-word) | Elite |
| Live avatar (animated face, real-time response) | Elite |

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- A **[Supabase](https://supabase.com/)** project (Postgres + auth)
- A **[Groq](https://groq.com/)** API key — primary AI provider
- A **[Razorpay](https://razorpay.com/)** account — test mode works for local dev
- **Redis** — optional locally; background jobs run inline without it

### Installation

```bash
git clone https://github.com/<your-org>/vachix.git
cd vachix

# Install root-level workspace dependencies
npm install

# Backend
cd backend
cp .env.example .env    # fill in required keys — see below
npm install
npm run dev             # starts on :8080 by default

# Frontend (new terminal)
cd frontend
npm install
npm run dev             # starts on :3000, proxies /api/* to backend
```

The frontend dev server proxies `/api/*` to `NEXT_PUBLIC_BACKEND_URL`. No manual CORS configuration needed in development.

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env`. The server **will refuse to start** in production if these are missing:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key — full DB access, keep secret |
| `SUPABASE_ANON_KEY` | Anon/public key for RLS-scoped operations |
| `JWT_SECRET` | Access token signing key |
| `JWT_REFRESH_SECRET` | Refresh token signing key (separate from access) |
| `REPORT_SECRET` | HMAC key for shareable session report links |
| `GROQ_API_KEY` | Groq inference — primary AI provider |
| `RAZORPAY_KEY_ID` | Razorpay public key |
| `RAZORPAY_KEY_SECRET` | Razorpay secret key |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature verification |

Optional (have sane defaults or degrade gracefully without them):

| Variable | Purpose |
|---|---|
| `REDIS_URL` | BullMQ job queue — jobs run inline if absent |
| `RESEND_API_KEY` | Transactional email — verification, resets, B2B follow-ups |
| `ELEVENLABS_API_KEY` | TTS voice responses (Pro/Elite feature) |
| `EXTRA_ALLOWED_ORIGINS` | Comma-separated list to extend the CORS allowlist (preview deploys) |
| `SENTRY_DSN` | Error tracking |

> **Never commit a populated `.env` file.** `SUPABASE_SERVICE_KEY` and the Razorpay secret grant full backend access. Treat them as passwords.

---

## Scripts

### Backend (`/backend`)

```bash
npm run dev        # ts-node-dev watch mode
npm run build      # tsc → dist/
npm start          # run compiled build (production)
npm run worker     # BullMQ background worker (run as separate process in prod)
npm test           # Jest test suite
```

### Frontend (`/frontend`)

```bash
npm run dev            # Next.js dev server
npm run build          # Next.js production build
npm run build:cf       # Next.js build + Cloudflare Pages adapter
npm run type-check     # tsc --noEmit (zero errors enforced)
npm run lint           # ESLint
npm run deploy         # build:cf + wrangler pages deploy
```

---

## Security Model

Defense in depth — neither surface is trusted to police the other.

**Token handling**
- Access and refresh tokens live exclusively in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Frontend JavaScript has no token access, which eliminates XSS-to-session-hijack as an attack class.
- The Next.js middleware gate runs at the edge — unauthenticated requests are redirected before they hit React.

**Server-side validation**
- Every privileged attribute (plan tier, admin role, email verification) is re-read from the database on every request. JWT claims are never trusted in isolation, so revoking a session or downgrading a plan takes effect immediately — no wait for token expiry.
- 422 vs 502 status code discipline: client input errors return 422, upstream failures return 502. Never mix these.

**Payment integrity**
- Razorpay webhooks are verified using constant-time HMAC comparison before any plan change is applied. The order-verify flow requires both the frontend signature *and* a passing webhook before a subscription is activated.

**Public endpoints**
- Shareable report links use HMAC-SHA256 with constant-time verification — not Base64 or sequential IDs.
- Per-route rate limiting on every public or auth-sensitive endpoint: login, registration, password reset, B2B lead intake, public report access.

**Secrets**
- No secrets in source. `.env.example` ships with placeholder values and inline documentation — no defaults that would silently work in production with a real secret.

---

## Deployment

### Frontend → Cloudflare Pages

```bash
cd frontend
npm run deploy    # next build + @cloudflare/next-on-pages + wrangler pages deploy
```

Set `EXTRA_ALLOWED_ORIGINS` on the backend to include your Cloudflare Pages preview URLs so CORS doesn't block PR deploys.

### Backend → Railway

1. Connect the `/backend` directory as the Railway service root.
2. Set all required environment variables in the Railway dashboard.
3. Railway auto-detects `npm run build && npm start` as the build/start command.
4. Run `npm run worker` as a **separate Railway service** pointing at the same repo — background jobs (email follow-ups, expiry) run in this process.

### Database migrations

Migrations live in `backend/migrations/`. Apply them to your Supabase project via the Supabase SQL editor or the Supabase CLI before first deploy.

---

## Roadmap

Short-term (in active development):
- Accent-tuned speech engine upgrade
- Elara spoken audio responses
- Pronunciation scoring (word-by-word)
- Animated avatar (live video-style face)

Medium-term:
- B2B institution dashboard (batch seat management, coordinator view, per-student progress)
- Mobile app (React Native, sharing session state with existing backend)
- Hindi-medium question sets

---

<div align="center">

Built for India's most competitive candidates — the ones who know every answer and just need to sound like it.

</div>
