# SpeakSmart Backend

## Environment Variables (set these in Railway)

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `SUPABASE_SERVICE_KEY` | your service_role JWT key |
| `JWT_SECRET` | any random string e.g. `speaksmart_super_secret_2024` |
| `GROQ_API_KEY` | your GROQ API key |
| `RAZORPAY_KEY_ID` | from Razorpay dashboard (test: `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | from Razorpay dashboard |
| `PORT` | set automatically by Railway |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | No | Create account |
| POST | `/api/login` | No | Login |
| GET | `/api/me` | Yes | Get user + usage |
| POST | `/api/ai` | Yes | Proxied AI call with usage tracking |
| POST | `/api/payment/create-order` | Yes | Create Razorpay order |
| POST | `/api/payment/verify` | Yes | Verify payment + upgrade to Pro |
