<div align="center">

# Vachix

**AI-powered interview & English-speaking practice for Indian students and job seekers.**

Practice real interview and spoken-English scenarios — UPSC, Bank PO, SSC, and campus placements — with instant AI feedback on fluency, grammar, and vocabulary.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js_15-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)

</div>

---

## Overview

Vachix pairs users with two AI coaches — **Aria** (interview practice) and **Elara** (English correction) — to simulate real spoken interviews and conversations, then scores each session on fluency, grammar, and vocabulary. It's built as a TypeScript monorepo: a Next.js frontend and an Express API, sharing a common deployment-ready architecture for auth, billing, and analytics.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Security](#security)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features

- **AI Interview Practice** — Realistic, role-specific interview simulations across 11+ tracks (UPSC, Bank PO, SSC, campus placements, and more), with streaming AI responses.
- **Live English Correction** — Real-time grammar, tense, and fluency correction powered by Elara AI.
- **Scored Feedback** — Every session is scored across fluency, grammar, and vocabulary dimensions, with weak-area tracking over time.
- **HD Voice Coaching** *(Pro/Elite)* — Natural-sounding spoken feedback via ElevenLabs, with a Web Speech API fallback for everyone else.
- **Shareable Reports** — Generate a cryptographically signed, tamper-proof link to share an interview report publicly.
- **Referrals** — Users earn bonus AI sessions by inviting friends via a unique referral code.
- **Subscriptions** — Free / Pro / Elite tiers with Razorpay-powered billing, webhook-verified activation, and instant plan upgrades.
- **B2B Lead Capture** — Dedicated, rate-limited lead-intake flow with automated email follow-ups for institutional partners.
- **Admin Dashboard** — Internal overview of users, subscriptions, and lead funnel — gated behind a hardened, DB-checked admin role.

## Architecture

```
┌─────────────────┐        same-origin /api/*        ┌──────────────────┐
│   Next.js 15     │ ───────────rewrite proxy───────► │   Express API     │
│   (frontend)     │ ◄──────── httpOnly cookies ───── │   (backend)        │
└─────────────────┘                                   └──────────────────┘
                                                              │
                                ┌─────────────────────────────┼─────────────────────────────┐
                                ▼                              ▼                             ▼
                        ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
                        │   Supabase   │              │ Groq / OpenAI│              │  Razorpay /   │
                        │  (Postgres)  │              │  (AI engine) │              │  Redis/BullMQ │
                        └──────────────┘              └──────────────┘              └──────────────┘
```

Authentication uses short-lived JWT access tokens + rotating refresh tokens, both stored in `httpOnly` cookies — the frontend's JavaScript never touches a token directly, which closes off the most common XSS-to-account-takeover path. The Next.js app proxies `/api/*` to the backend at the edge so cookies stay same-origin in the browser regardless of where the API is actually hosted.

## Tech Stack

**Frontend**
- [Next.js 15](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [TanStack Query](https://tanstack.com/query) for server state
- [Zustand](https://zustand-demo.pmnd.rs/) for client state
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Zod](https://zod.dev/) for shared validation schemas

**Backend**
- [Express](https://expressjs.com/) + TypeScript
- [Supabase](https://supabase.com/) (Postgres + Row Level Security)
- [BullMQ](https://docs.bullmq.io/) + [Redis](https://redis.io/) for background jobs (follow-up emails, subscription/session expiry)
- [Razorpay](https://razorpay.com/) for payments
- [Groq](https://groq.com/) / [OpenAI](https://openai.com/) for AI inference, with circuit-breaker failover between providers
- [Resend](https://resend.com/) for transactional email
- [Winston](https://github.com/winstonjs/winston) + [Sentry](https://sentry.io/) for logging and error tracking

## Project Structure

```
vachix/
├── frontend/                  Next.js 15 application
│   ├── app/
│   │   ├── (auth)/            Public routes — login, register, password reset
│   │   └── (app)/             Protected routes — dashboard, interview, profile, admin
│   ├── components/            Shared UI + feature components
│   ├── features/              Feature-scoped API clients, hooks, and schemas
│   ├── store/                 Zustand stores (auth, UI, interview session)
│   ├── lib/                   Core API client, utilities
│   └── middleware.ts          Edge auth gate
│
├── backend/                   Express API
│   ├── src/
│   │   ├── app.ts             Entry point — security headers, CORS, routes
│   │   ├── core/               Config, DB client, middleware, shared utils
│   │   ├── infra/              Queues, rate limiting, circuit breakers, observability
│   │   └── modules/            Feature modules (auth, ai, payment, reports, admin, …)
│   └── migrations/             SQL migrations
│
└── shared/                    Types and schemas shared across both apps
```

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/) project (Postgres + Auth)
- A [Razorpay](https://razorpay.com/) account (test mode is fine for local dev)
- A [Groq](https://groq.com/) API key (required) and/or an OpenAI key (optional fallback)
- Redis (optional locally — background jobs run inline without it)

### Installation

```bash
git clone <your-repo-url>
cd vachix

# Backend
cd backend
npm install
cp .env.example .env   # fill in your keys — see below
npm run dev

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` and proxies `/api/*` requests to the backend (configured via `NEXT_PUBLIC_BACKEND_URL`).

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the required values. At minimum, the backend will refuse to start in production without:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Database access |
| `SUPABASE_ANON_KEY` | RLS-scoped client access (required in production) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Token signing |
| `REPORT_SECRET` | HMAC signing for shareable report links |
| `GROQ_API_KEY` | Primary AI inference provider |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Payments |

All other variables (email, Redis, voice, observability, rate-limit tuning) are optional and have sane defaults — see `backend/.env.example` for the full list with inline documentation.

> **Warning:** Never commit a populated `.env` file. `SUPABASE_SERVICE_KEY` and the Razorpay secret keys grant full backend access — treat them like passwords.

## Available Scripts

**Backend** (`/backend`)

| Command | Description |
|---|---|
| `npm run dev` | Start the API in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled production build |
| `npm run worker` | Start the BullMQ background worker |
| `npm test` | Run the Jest test suite |

**Frontend** (`/frontend`)

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run type-check` | Type-check without emitting |
| `npm run lint` | Run ESLint |

## Security

Vachix follows a defense-in-depth approach across both apps:

- **Tokens never touch JavaScript** — access/refresh tokens live in `httpOnly`, `secure`, `SameSite=Lax` cookies only.
- **Every privileged check is DB-authoritative** — admin status, plan, and email-verification are always re-checked against the database, never trusted from a JWT claim alone, so revocations and downgrades take effect immediately.
- **Signed share links** — public report links use HMAC-SHA256 signing with constant-time verification, not reversible encoding.
- **Constant-time comparisons** on all secret/token checks (payment webhooks, internal metrics endpoint) to close timing side-channels.
- **Strict CORS allowlist** in every environment, including staging/preview.
- **Per-route rate limiting** on every public or auth-sensitive endpoint (login, registration, password reset, lead capture, public reports).

If you discover a security issue, please **do not open a public GitHub issue**. Email the maintainers directly so it can be fixed before disclosure.

## Deployment

- **Frontend** — designed for Cloudflare Pages or Vercel (`npm run build:cf` / `npm run deploy` for Cloudflare Pages via Wrangler).
- **Backend** — designed for Railway or any Node-compatible host; run `npm run build && npm start`, with `npm run worker` as a separate process for background jobs.
- Set `EXTRA_ALLOWED_ORIGINS` to whitelist preview/staging URLs without a code deploy.

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes, with tests where applicable.
3. Run `npm run type-check` (frontend) and `npm test` (backend) before opening a PR.
4. Open a pull request describing what changed and why.

## License

This project is currently unlicensed for public use. Contact the maintainers before reusing any part of this codebase.

---

<div align="center">
Built for India's next generation of confident communicators.
</div>
