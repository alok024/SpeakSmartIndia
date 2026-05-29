const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════
//  CONFIG — all values come from env vars on Railway
// ══════════════════════════════════════════
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;  // service_role key
const JWT_SECRET       = process.env.JWT_SECRET;            // any random string you set
const FREE_LIMIT       = 30;
const PRO_PRICE_PAISE  = 29900; // ₹299 in paise

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ══════════════════════════════════════════
//  SUPABASE HELPER  (simple fetch wrapper)
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
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
    res.status(401).json({ error: 'Invalid token' });
  }
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
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if user already exists
    const check = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (check.data && check.data.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    // Hash password and create user
    const password_hash = await bcrypt.hash(password, 10);
    const { ok, data } = await sb('/users', 'POST', { email, password_hash, plan: 'free' });

    if (!ok) return res.status(500).json({ error: 'Failed to create user' });

    const user = data[0];

    // Create usage row
    await sb('/usage', 'POST', { user_id: user.id, call_count: 0 });

    // Issue JWT
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });

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

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  GET USER DATA  (usage count, plan)
// ══════════════════════════════════════════
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const { data: users } = await sb(`/users?id=eq.${req.user.id}&select=id,email,plan`);
    const { data: usage } = await sb(`/usage?user_id=eq.${req.user.id}&select=call_count`);

    const user = users[0];
    const callCount = usage?.[0]?.call_count || 0;

    res.json({
      user: { id: user.id, email: user.email, plan: user.plan },
      usage: { call_count: callCount, limit: user.plan === 'pro' ? null : FREE_LIMIT, remaining: user.plan === 'pro' ? null : Math.max(0, FREE_LIMIT - callCount) }
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  AI CALL  (proxies to Claude/OpenAI, tracks usage)
// ══════════════════════════════════════════
app.post('/api/ai', authMiddleware, async (req, res) => {
  try {
    const { data: users } = await sb(`/users?id=eq.${req.user.id}&select=plan`);
    const { data: usage } = await sb(`/usage?user_id=eq.${req.user.id}&select=call_count`);

    const plan = users?.[0]?.plan || 'free';
    const callCount = usage?.[0]?.call_count || 0;

    // Check free limit
    if (plan === 'free' && callCount >= FREE_LIMIT) {
      return res.status(403).json({ error: 'limit_reached', calls_used: callCount });
    }

    // Increment usage count
    await sb(`/usage?user_id=eq.${req.user.id}`, 'PATCH', {
      call_count: callCount + 1,
      updated_at: new Date().toISOString(),
    });

    // Forward the actual AI request (req.body contains { messages, system, model })
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      req.body.model || 'claude-haiku-4-5-20251001',
        max_tokens: req.body.max_tokens || 1024,
        system:     req.body.system,
        messages:   req.body.messages,
      }),
    });

    const aiData = await aiRes.json();
    res.json({ ...aiData, calls_used: callCount + 1, limit: plan === 'pro' ? null : FREE_LIMIT });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
//  RAZORPAY — CREATE ORDER
// ══════════════════════════════════════════
app.post('/api/payment/create-order', authMiddleware, async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount:   PRO_PRICE_PAISE,
      currency: 'INR',
      notes:    { user_id: req.user.id, email: req.user.email },
    });
    res.json({ order_id: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ══════════════════════════════════════════
//  RAZORPAY — VERIFY PAYMENT & UPGRADE USER
// ══════════════════════════════════════════
app.post('/api/payment/verify', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.status(400).json({ error: 'Payment verification failed' });

    // Upgrade user to pro
    await sb(`/users?id=eq.${req.user.id}`, 'PATCH', { plan: 'pro' });

    // Reset usage count on upgrade (fresh start)
    await sb(`/usage?user_id=eq.${req.user.id}`, 'PATCH', { call_count: 0 });

    // Issue new token with updated plan
    const token = jwt.sign({ id: req.user.id, email: req.user.email, plan: 'pro' }, JWT_SECRET, { expiresIn: '30d' });
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
app.listen(PORT, () => console.log(`SpeakSmart backend running on port ${PORT}`));
