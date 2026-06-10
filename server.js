const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');

// ══════════════════════════════════════════
//  STARTUP ENV CHECK
// ══════════════════════════════════════════
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'GROQ_API_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET      = process.env.JWT_SECRET;
const FREE_LIMIT      = 30;
const PRO_PRICE_PAISE = 29900; // ₹299

// ══════════════════════════════════════════
//  APP SETUP
// ══════════════════════════════════════════
const app = express();
app.set('trust proxy', 1);

// CORS — restrict to your own domain in production
const ALLOWED_ORIGINS = [
  'https://speaksmart.in',
  'https://www.speaksmart.in',
  'https://speaksmartindia.vercel.app',
  // Keep localhost for local dev
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // During development, allow all origins — remove this line in strict production
    return cb(null, true);
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// Rate limit AI endpoint — 20 calls/min per IP
app.use('/api/ai', rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: 'Too many requests. Please wait a minute.' },
}));

// Rate limit auth endpoints — prevent brute force
app.use('/api/login', rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many login attempts.' } }));
app.use('/api/register', rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many registration attempts.' } }));

// ══════════════════════════════════════════
//  SUPABASE HELPER
// ══════════════════════════════════════════
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ══════════════════════════════════════════
//  AUTH MIDDLEWARE
// ══════════════════════════════════════════
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ══════════════════════════════════════════
//  RAZORPAY HELPER
// ══════════════════════════════════════════
function getRazorpay() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ══════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════
app.get('/', (req, res) => res.json({ status: 'SpeakSmart backend running ✅', version: '2.0' }));

// ══════════════════════════════════════════
//  REGISTER
// ══════════════════════════════════════════
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
      return res.status(400).json({ error: 'Invalid email format' });

    const check = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (check.data && check.data.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 10);
    const { ok, data } = await sb('/users', 'POST', {
      email,
      password_hash,
      plan: 'free',
      name: name || '',
    });
    if (!ok) return res.status(500).json({ error: 'Failed to create user' });

    const user = data[0];

    await Promise.all([
      sb('/usage', 'POST', { user_id: user.id, call_count: 0 }),
      sb('/stats', 'POST', { user_id: user.id, streak: 0, sessions: 0, best_score: 0, total_score: 0 }),
    ]);

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan, name: name || '' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan, name: name || '' } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=*`);
    if (!users || users.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user  = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan, name: user.name || '' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan, name: user.name || '' } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  PASSWORD RESET — REQUEST
//  Stores a reset token in the DB (expires 1hr)
// ══════════════════════════════════════════
app.post('/api/password-reset/request', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id,email`);
    // Always return success — don't reveal whether email exists
    if (!users || users.length === 0)
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });

    const user = users[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Store reset token — you need a password_resets table in Supabase:
    // CREATE TABLE password_resets (id uuid, user_id uuid, token text, expires_at timestamptz, used boolean DEFAULT false)
    await sb('/password_resets', 'POST', {
      user_id:    user.id,
      token:      resetToken,
      expires_at: expiresAt,
      used:       false,
    });

    // TODO: Send email via SendGrid/Resend/Nodemailer with reset link:
    // https://yourdomain.com/reset-password?token=<resetToken>
    console.log(`[PASSWORD RESET] Token for ${email}: ${resetToken}`); // Remove in production

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Password reset request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  PASSWORD RESET — CONFIRM
// ══════════════════════════════════════════
app.post('/api/password-reset/confirm', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password)
      return res.status(400).json({ error: 'Token and new password required' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { data: resets } = await sb(
      `/password_resets?token=eq.${token}&used=eq.false&select=*`
    );
    if (!resets || resets.length === 0)
      return res.status(400).json({ error: 'Invalid or expired reset token' });

    const reset = resets[0];
    if (new Date(reset.expires_at) < new Date())
      return res.status(400).json({ error: 'Reset token has expired' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await sb(`/users?id=eq.${reset.user_id}`, 'PATCH', { password_hash });
    await sb(`/password_resets?id=eq.${reset.id}`, 'PATCH', { used: true });

    res.json({ success: true, message: 'Password updated successfully. Please log in.' });
  } catch (err) {
    console.error('Password reset confirm error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  REFRESH TOKEN
// ══════════════════════════════════════════
app.post('/api/refresh-token', authMiddleware, async (req, res) => {
  try {
    const { data: users } = await sb(`/users?id=eq.${req.user.id}&select=id,email,plan,name`);
    if (!users || users.length === 0)
      return res.status(404).json({ error: 'User not found' });

    const user  = users[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan, name: user.name || '' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan, name: user.name || '' } });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  ME  (user + usage + stats)
// ══════════════════════════════════════════
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [{ data: users }, { data: usage }, { data: stats }] = await Promise.all([
      sb(`/users?id=eq.${req.user.id}&select=id,email,plan,name`),
      sb(`/usage?user_id=eq.${req.user.id}&select=call_count`),
      sb(`/stats?user_id=eq.${req.user.id}&select=*`),
    ]);

    const user      = users[0];
    const callCount = usage?.[0]?.call_count || 0;
    const userStats = stats?.[0] || { streak: 0, sessions: 0, best_score: 0, total_score: 0 };

    res.json({
      user:  { id: user.id, email: user.email, plan: user.plan, name: user.name, ai_calls: callCount },
      usage: {
        call_count: callCount,
        limit:      user.plan === 'pro' ? null : FREE_LIMIT,
        remaining:  user.plan === 'pro' ? null : Math.max(0, FREE_LIMIT - callCount),
      },
      stats: userStats,
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  AI CALL — Groq primary, OpenAI fallback
//  Order: check limit → call Groq →
//         fallback to OpenAI if Groq fails →
//         increment usage → respond
// ══════════════════════════════════════════
const SYSTEM_PROMPT = `You are Aria, an AI interview coach for SpeakSmart. \
Help users practice job interviews, evaluate their answers, give structured feedback, \
and improve their English communication. Only assist with interview-related tasks. \
Be concise and direct.`;

async function callGroq(messages, max_tokens) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:      'llama-3.3-70b-versatile',
      max_tokens: max_tokens || 1024,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Groq error: ${JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAIFallback(messages, max_tokens) {
  if (!process.env.OPENAI_API_KEY) throw new Error('No OpenAI fallback configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:      'gpt-4o-mini',
      max_tokens: max_tokens || 1024,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content || '';
}

app.post('/api/ai', authMiddleware, async (req, res) => {
  try {
    const { data: users } = await sb(`/users?id=eq.${req.user.id}&select=plan`);
    const { data: usage } = await sb(`/usage?user_id=eq.${req.user.id}&select=call_count`);

    const plan      = users?.[0]?.plan || 'free';
    const callCount = usage?.[0]?.call_count || 0;

    if (plan === 'free' && callCount >= FREE_LIMIT)
      return res.status(403).json({ error: 'limit_reached', calls_used: callCount });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(req.body.messages || []),
    ];

    let text = '';
    let provider = 'groq';

    // Try Groq first, fall back to OpenAI if it fails
    try {
      text = await callGroq(messages, req.body.max_tokens);
    } catch (groqErr) {
      console.error('Groq failed, trying OpenAI fallback:', groqErr.message);
      provider = 'openai_fallback';
      try {
        text = await callOpenAIFallback(messages, req.body.max_tokens);
      } catch (openaiErr) {
        console.error('OpenAI fallback also failed:', openaiErr.message);
        return res.status(502).json({ error: 'AI service temporarily unavailable. Please try again in a moment.' });
      }
    }

    // Increment usage AFTER successful AI response
    await sb(`/usage?user_id=eq.${req.user.id}`, 'PATCH', {
      call_count: callCount + 1,
      updated_at: new Date().toISOString(),
    });

    res.json({
      text,
      calls_used: callCount + 1,
      limit:      plan === 'pro' ? null : FREE_LIMIT,
      remaining:  plan === 'pro' ? null : Math.max(0, FREE_LIMIT - (callCount + 1)),
      provider,   // useful for debugging
    });
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  SAVE SESSION
// ══════════════════════════════════════════
app.post('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const {
      profession, mode, difficulty, interview_type,
      personality, score, exchanges, duration_secs,
      hindi_mode, feedbacks,
    } = req.body;

    const { data: sessionData, ok } = await sb('/sessions', 'POST', {
      user_id:        req.user.id,
      profession:     profession    || 'General',
      mode:           mode          || 'classic',
      difficulty:     difficulty    || 'beginner',
      interview_type: interview_type || 'mixed',
      personality:    personality   || 'friendly',
      score:          score         || 0,
      exchanges:      exchanges     || 0,
      duration_secs:  duration_secs || 0,
      hindi_mode:     hindi_mode    || false,
    });

    if (!ok) return res.status(500).json({ error: 'Failed to save session' });
    const session = sessionData[0];

    if (feedbacks && feedbacks.length > 0) {
      await Promise.all(feedbacks.map(f => sb('/feedback', 'POST', {
        session_id:   session.id,
        question:     f.q || f.question || '',
        answer:       f.answer        || '',
        score:        f.score         || 0,
        corrections:  JSON.stringify(f.english_errors || f.corrections || []),
        tips:         f.tip  || f.tips || '',
        structure:    JSON.stringify(f.structure    || {}),
        model_answer: JSON.stringify(f.model_answer || {}),
      })));
    }

    const { data: statsArr } = await sb(`/stats?user_id=eq.${req.user.id}&select=*`);
    const existing    = statsArr?.[0];
    const today       = new Date().toDateString();
    const yesterday   = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastSession = existing?.last_session
      ? new Date(existing.last_session).toDateString()
      : null;

    const newStreak = lastSession === today
      ? (existing?.streak || 0)
      : lastSession === yesterday.toDateString()
        ? (existing?.streak || 0) + 1
        : 1;

    const newSessions = (existing?.sessions   || 0) + 1;
    const newBest     = Math.max(existing?.best_score  || 0, score || 0);
    const newTotal    = (existing?.total_score || 0) + (score || 0);

    if (existing) {
      await sb(`/stats?user_id=eq.${req.user.id}`, 'PATCH', {
        streak:       newStreak,
        sessions:     newSessions,
        best_score:   newBest,
        total_score:  newTotal,
        last_session: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      });
    } else {
      await sb('/stats', 'POST', {
        user_id:      req.user.id,
        streak:       1,
        sessions:     1,
        best_score:   score || 0,
        total_score:  score || 0,
        last_session: new Date().toISOString(),
      });
    }

    res.json({
      success:    true,
      session_id: session.id,
      streak:     newStreak,
      sessions:   newSessions,
      best_score: newBest,
    });
  } catch (err) {
    console.error('Session save error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  GET SESSION LIST
// ══════════════════════════════════════════
app.get('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const { data } = await sb(
      `/sessions?user_id=eq.${req.user.id}&order=created_at.desc&limit=20&select=*`
    );
    res.json({ sessions: data || [] });
  } catch (err) {
    console.error('Sessions list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  GET SINGLE SESSION + FEEDBACK
// ══════════════════════════════════════════
app.get('/api/session/:id', authMiddleware, async (req, res) => {
  try {
    const { data: sessions } = await sb(
      `/sessions?id=eq.${req.params.id}&user_id=eq.${req.user.id}&select=*`
    );
    if (!sessions || sessions.length === 0)
      return res.status(404).json({ error: 'Session not found' });

    const { data: feedbacks } = await sb(
      `/feedback?session_id=eq.${req.params.id}&select=*&order=created_at.asc`
    );

    const parsedFeedbacks = (feedbacks || []).map(f => ({
      ...f,
      corrections:  safeJsonParse(f.corrections,  []),
      structure:    safeJsonParse(f.structure,    {}),
      model_answer: safeJsonParse(f.model_answer, {}),
    }));

    res.json({ session: sessions[0], feedbacks: parsedFeedbacks });
  } catch (err) {
    console.error('Session detail error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function safeJsonParse(val, fallback) {
  try { return typeof val === 'string' ? JSON.parse(val) : val ?? fallback; }
  catch { return fallback; }
}

// ══════════════════════════════════════════
//  RAZORPAY — CREATE ORDER
// ══════════════════════════════════════════
app.post('/api/payment/create-order', authMiddleware, async (req, res) => {
  try {
    const order = await getRazorpay().orders.create({
      amount:   PRO_PRICE_PAISE,
      currency: 'INR',
      notes:    { user_id: String(req.user.id), email: req.user.email },
    });
    res.json({
      order_id: order.id,
      amount:   order.amount,
      currency: order.currency,
      key:      process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ══════════════════════════════════════════
//  RAZORPAY — VERIFY PAYMENT
// ══════════════════════════════════════════
app.post('/api/payment/verify', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.status(400).json({ error: 'Payment verification failed' });

    await sb(`/users?id=eq.${req.user.id}`, 'PATCH', { plan: 'pro' });
    await sb(`/usage?user_id=eq.${req.user.id}`, 'PATCH', { call_count: 0 });

    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, plan: 'pro', name: req.user.name || '' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ success: true, token, plan: 'pro' });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  START
// ══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SpeakSmart backend running on port ${PORT} 🚀`));
