# `features/` — module layout

Each feature is a vertical slice that owns its own API calls, types, React
Query hooks, validation schemas, and components. The rule of thumb: **if
you're adding a new endpoint, it gets a typed wrapper in the matching
feature's `api/index.ts` — never a new method on a shared `api` object.**

```
features/<feature>/
  api/index.ts       — typed HTTP calls, built on apiCall() from @/lib/api
  types/index.ts      — request/response shapes for this feature's endpoints
  hooks/index.ts      — React Query hooks (useXyz) that call the api module
  schemas/index.ts    — Zod schemas for client-side form validation (if any)
  components/         — feature-specific UI
```

## Shared infrastructure (not feature-specific)

| Path | Purpose |
|---|---|
| `lib/api.ts` | `apiCall()` core fetch wrapper (auth refresh, error shape), `extractErrorMessage`, `BACKEND_URL`. Nothing else belongs here. |
| `lib/query-keys.ts` | `QK` — shared React Query key registry, so one feature can invalidate another's cache (e.g. saving a session invalidates `/me` and the sessions list) without a circular import. |
| `types/index.ts` (root) | Core domain primitives shared across features: `User`, `Session`, `Feedback`, `ApiResult`, etc. |

## Feature ownership map

| Feature | Endpoints | Notes |
|---|---|---|
| `auth` | `/login`, `/register`, `/logout`, `/verify-email`, `/verify-email/resend`, `/password-reset/request` | |
| `user` | `/me`, `/onboarding`, `/referral` | Profile, onboarding status, referral stats |
| `interview` | `/sessions` (POST), `/sessions/:id`, `/sessions/:id/share-token` | Creating + reading a single session |
| `analytics` | `/sessions` (GET, list), `/sessions/score-history` | History page + dashboard chart |
| `payment` | `/payment/order`, `/payment/verify` | Razorpay checkout |
| `ai` | `/ai`, `/ai/stream` | Chat proxy — shared by interview chat mode and English practice |
| `voice` | `/voice/tts` | Text-to-speech during live sessions |
| `reports` | `/report/:shareToken` | Public, unauthenticated shared-report page |

## Adding a new endpoint

1. Decide which feature owns it (or create a new `features/<name>/` if it's
   a genuinely new domain).
2. Add the response/request shape to that feature's `types/index.ts`.
3. Add the call to that feature's `api/index.ts`, using `apiCall<T>(...)`
   from `@/lib/api`.
4. If it needs caching/mutation state, add a hook in `hooks/index.ts`. Add
   any new query key to `lib/query-keys.ts` only if another feature will
   need to invalidate it — otherwise keep it local to the hook.
5. Import the hook (or the `*Api` object directly for one-off calls) from
   the page/component.

## Pages that bypass hooks

`app/(public)/admin/page.tsx` and `app/(public)/b2b/page.tsx` call
`apiCall` directly for one-off admin/lead endpoints rather than going
through a feature `api/` module. That's an acceptable shortcut for
isolated public pages with no shared state — if either grows
React-Query-worthy caching needs, give it its own `features/admin` or
`features/leads` slice following the pattern above.
