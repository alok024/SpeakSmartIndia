const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');

// ══════════════════════════════════════════
//  STARTUP ENV CHECK
//  Crashes loudly if a required variable is
//  missing — better than silent failures later
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
app.set('trust proxy', 1); // Required for Railway (sits behind a proxy)
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Rate limit only the AI endpoint — 20 calls/min per IP
app.use('/api/ai', rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: 'Too many requests. Please wait a minute.' },
}));

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
app.get('/', (req, res) => res.json({ status: 'SpeakSmart backend running ✅' }));

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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
      return res.status(400).json({ error: 'Invalid email format' });

    // Check duplicate email
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

    // Create usage + stats rows in parallel
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
//  REFRESH TOKEN
//  Call after payment upgrade so the JWT
//  reflects the new plan without re-login
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
//  AI CALL  (proxies Groq — never exposes key)
//  Order: check limit → build messages →
//         call Groq → increment usage → respond
// ══════════════════════════════════════════
const SYSTEM_PROMPT = `You are an AI interview coach for SpeakSmart. \
Help users practice job interviews, evaluate their answers, give structured feedback, \
and improve their English communication. Only assist with interview-related tasks.`;

app.post('/api/ai', authMiddleware, async (req, res) => {
  try {
    const { data: users } = await sb(`/users?id=eq.${req.user.id}&select=plan`);
    const { data: usage } = await sb(`/usage?user_id=eq.${req.user.id}&select=call_count`);

    const plan      = users?.[0]?.plan || 'free';
    const callCount = usage?.[0]?.call_count || 0;

    // Block free users who hit the limit
    if (plan === 'free' && callCount >= FREE_LIMIT)
      return res.status(403).json({ error: 'limit_reached', calls_used: callCount });

    // Build messages — system prompt is locked here, not from client
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(req.body.messages || []),
    ];

    // Call Groq
    const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        max_tokens: req.body.max_tokens || 1024,
        messages,
      }),
    });

    const aiData = await aiRes.json();

    // Log Groq errors for debugging — visible in Railway logs
    if (!aiRes.ok) {
      console.error('Groq error:', JSON.stringify(aiData));
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const text = aiData.choices?.[0]?.message?.content || '';

    // Increment usage AFTER successful AI response
    await sb(`/usage?user_id=eq.${req.user.id}`, 'PATCH', {
      call_count: callCount + 1,
      updated_at: new Date().toISOString(),
    });

    res.json({ text, calls_used: callCount + 1, limit: plan === 'pro' ? null : FREE_LIMIT });
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

    // Save per-question feedback rows in parallel
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

    // Update streak + stats
    const { data: statsArr } = await sb(`/stats?user_id=eq.${req.user.id}&select=*`);
    const existing    = statsArr?.[0];
    const today       = new Date().toDateString();
    const yesterday   = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastSession = existing?.last_session
      ? new Date(existing.last_session).toDateString()
      : null;

    // Streak logic:
    //   same day    → keep current streak (already practiced today)
    //   yesterday   → increment streak (consecutive day)
    //   older/null  → reset to 1
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
//  Used when user clicks a past session to
//  review their detailed per-question feedback
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

    // Parse JSON strings back to objects
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
//  Upgrades user to pro + issues fresh token
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

    // Issue fresh token so frontend immediately reflects pro plan
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
