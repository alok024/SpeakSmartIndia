# `features/` — module layout

Each feature is a vertical slice owning its API calls, types, React Query
hooks, and validation schemas. Files sit flat inside the feature directory —
no subdirectories per concern.

```
features/<feature>/
  api.ts       — typed HTTP calls, built on apiCall() from @/lib/api
  types.ts     — request/response shapes for this feature's endpoints
  hooks.ts     — React Query hooks (useQuery/useMutation wrappers)
  schemas.ts   — Zod schemas for client-side form validation (if any)
```

Special cases that deviate from the pattern:

| Feature | Shape | Reason |
|---|---|---|
| `avatar` | `useBargeIn.ts`, `useSimliAvatar.ts` | Pure hooks, no HTTP layer |
| `voice` | `api.ts`, `useAriaVoice.ts` | Hook owns TTS routing logic across Web Speech + Sarvam |
| `elara` | `api.ts`, `prompts.ts`, `useElaraVoice.ts` | System prompts live close to the AI feature |
| `ai` | `api.ts`, `types.ts` | No hooks — callers call `aiApi` directly inside effects |

## Shared infrastructure

| Path | Purpose |
|---|---|
| `lib/api.ts` | `apiCall()` fetch wrapper — auth refresh, error shape, BACKEND_URL |
| `lib/query-keys.ts` | Shared React Query key registry (`QK`) |
| `lib/interview-prompts.ts` | Aria system prompts and prompt builders |
| `lib/utils.ts` | Pure client-side utilities — class merging, date formatting, score colours |
| `lib/speech-analysis.ts` | WPM estimation and filler-word detection |
| `types/index.ts` | Core domain primitives: `User`, `Session`, `Feedback`, `ApiResult` |
| `store/` | Zustand stores — `auth`, `interview`, `ui` |

## Component layout

```
components/
  layout/    — AppShell, ProtectedRoute, ErrorBoundary, ToastStack, CookieConsent
  charts/    — ScoreHistoryChart, SpeechTrendsChart, EnglishJourneyChart
  shared/    — UpgradeModal, JobLandedModal, VoiceSettingsPanel, ElaraSettingsPanel
  landing/   — LandingPage
  ui/        — Button, Card, Spinner, ScoreRing, Badge, and other primitives
```

## Adding a new endpoint

1. Decide which feature owns it (or create `features/<name>/` for a new domain).
2. Add request/response shapes to `features/<name>/types.ts`.
3. Add the call to `features/<name>/api.ts` using `apiCall<T>(...)`.
4. Add a hook in `hooks.ts` if the call needs React Query caching.
   Add a new key to `lib/query-keys.ts` only if another feature will need to
   invalidate it — otherwise keep it local to the hook.

## Feature ownership map

| Feature | Endpoints |
|---|---|
| `auth` | `/login`, `/register`, `/logout`, `/verify-email`, `/password-reset/*` |
| `user` | `/me`, `/onboarding`, `/referral`, `/daf`, `/company-mode`, `/user/job-landed`, `/user/results-board` |
| `interview` | `/sessions` POST, `/sessions/:id`, `/sessions/:id/share-token`, `/interview/jd-questions` |
| `analytics` | `/sessions` GET, `/sessions/score-history`, `/sessions/readiness-report`, `/leaderboard` |
| `payment` | `/payment/order`, `/payment/verify` |
| `ai` | `/ai`, `/ai/stream`, `/ai/hint` |
| `elara` | `/elara/*` — English coaching sessions, vocab, debrief |
| `voice` | `/voice/tts`, `/voice/settings`, `/voice/free-tts-*`, `/voice/avatar/*` |
| `speech` | `/speech/metrics` — WPM/filler counts saved post-session |
| `certificates` | `/sessions/readiness-report/certificate-token` |
| `comparison` | `/compare/*` — peer score comparison links |
| `prep-paths` | `/prep-paths/*` — guided study track enrollment |
| `push` | `/push/*` — web push notification subscription |
| `reports` | `/report/:shareToken` — public shared-report page |
| `daily-question` | `/daily-question` — today's practice question |
