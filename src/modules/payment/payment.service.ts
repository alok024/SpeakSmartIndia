import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env, PLAN_PRICES } from '../../core/config/env';
import { db } from '../../core/database/client';
import { generateTokens } from '../auth/auth.service';
import { paymentLogger } from '../../infra/logger';

// ── Razorpay instance ─────────────────────────────────────────────

function getRazorpay(): Razorpay {
  return new Razorpay({
    key_id:     env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
}

// ── Create Razorpay order ─────────────────────────────────────────

export async function createOrder(
  userId: string,
  email:  string,
  plan:   'pro' | 'elite'
) {
  const amount = PLAN_PRICES[plan];

  const order = await getRazorpay().orders.create({
    amount,
    currency: 'INR',
    notes:    { user_id: userId, email, plan },
  });

  paymentLogger.info('Razorpay order created', {
    userId, plan, orderId: order.id, amount,
  });

  return {
    order_id: order.id,
    amount:   order.amount,
    currency: order.currency,
    key:      env.RAZORPAY_KEY_ID,
    plan,
  };
}

// ── Verify payment signature (client callback) ────────────────────

export function verifySignature(
  orderId:   string,
  paymentId: string,
  signature: string
): boolean {
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

// ── Activate subscription ─────────────────────────────────────────
// Idempotent — safe to call from both client callback AND webhook.

export async function activateSubscription(
  userId:    string,
  plan:      'pro' | 'elite',
  orderId:   string,
  paymentId: string
): Promise<string> {
  const now       = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + 1); // 30-day subscription

  const existing = await db.getActiveSubscription(userId);

  if (existing) {
    await db.updateSubscription(existing.id!, {
      plan,
      razorpay_order_id:   orderId,
      razorpay_payment_id: paymentId,
      expires_at:          expiresAt.toISOString(),
    });
  } else {
    await db.createSubscription({
      user_id:             userId,
      plan,
      status:              'active',
      razorpay_order_id:   orderId,
      razorpay_payment_id: paymentId,
      started_at:          now.toISOString(),
      expires_at:          expiresAt.toISOString(),
    });
  }

  // Update plan + reset usage counter
  await Promise.all([
    db.updateUser(userId, { plan }),
    db.resetUsage(userId),
  ]);

  paymentLogger.info('Subscription activated', { userId, plan, orderId, paymentId });

  // Issue fresh JWT with updated plan embedded
  const user = await db.getUserById(userId);
  if (!user) throw new Error('User not found after subscription activation');

  const { token } = generateTokens(user);
  return token;
}

// ── Webhook (PRIMARY activation path) ────────────────────────────
// Registered in app.ts BEFORE express.json() with raw body parser.

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  // 1. Verify authenticity
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (expected !== signature) {
    paymentLogger.warn('Webhook signature mismatch — possible spoofing attempt');
    throw Object.assign(new Error('Invalid webhook signature'), { statusCode: 400 });
  }

  const event = JSON.parse(rawBody.toString()) as RazorpayWebhookEvent;

  paymentLogger.info('Webhook received', {
    event:     event.event,
    paymentId: event.payload?.payment?.entity?.id,
  });

  // 2. Idempotency — skip if we already processed this payment
  const paymentId = event.payload?.payment?.entity?.id;
  if (paymentId) {
    const duplicate = await db.getSubscriptionByPaymentId(paymentId);
    if (duplicate) {
      paymentLogger.info('Duplicate webhook — already processed', { paymentId });
      return;
    }
  }

  // 3. Route by event type
  switch (event.event) {
    case 'payment.captured':
      await onPaymentCaptured(event);
      break;
    case 'payment.failed':
      onPaymentFailed(event);
      break;
    case 'subscription.cancelled':
      await onSubscriptionCancelled(event);
      break;
    default:
      paymentLogger.debug('Unhandled webhook event', { event: event.event });
  }
}

// ── Webhook event handlers ────────────────────────────────────────

async function onPaymentCaptured(event: RazorpayWebhookEvent): Promise<void> {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const userId = payment.notes?.user_id;
  const plan   = payment.notes?.plan as 'pro' | 'elite' | undefined;

  if (!userId || !plan || !['pro', 'elite'].includes(plan)) {
    paymentLogger.error('Webhook: missing or invalid user_id/plan in payment notes', { payment });
    return;
  }

  await activateSubscription(userId, plan, payment.order_id, payment.id);

  paymentLogger.info('Payment captured via webhook', {
    userId,
    plan,
    paymentId: payment.id,
    orderId:   payment.order_id,
    amount:    payment.amount,
  });
}

function onPaymentFailed(event: RazorpayWebhookEvent): void {
  const payment = event.payload?.payment?.entity;
  paymentLogger.warn('Payment failed', {
    paymentId: payment?.id,
    reason:    payment?.error_description,
    userId:    payment?.notes?.user_id,
  });
}

async function onSubscriptionCancelled(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;

  // sub.id is a Razorpay subscription ID (e.g. "sub_XXXXX"), NOT a user_id.
  // Use the user_id stored in the subscription notes instead.
  const userId = sub.notes?.user_id;
  if (!userId) {
    paymentLogger.error('Webhook: subscription.cancelled missing user_id in notes', { subId: sub.id });
    return;
  }

  const existing = await db.getActiveSubscription(userId);
  if (!existing) return;

  await db.updateSubscription(existing.id!, { status: 'cancelled' });
  await db.updateUser(existing.user_id, { plan: 'free' });

  paymentLogger.info('Subscription cancelled via webhook', { userId: existing.user_id });
}

// ── Subscription expiry cron ──────────────────────────────────────
// Called on app startup then every hour via setInterval in app.ts.
// Marks expired subscriptions and downgrades the user's plan to free.

export async function expireOverdueSubscriptions(): Promise<void> {
  const expired = await db.getExpiredActiveSubscriptions();
  if (expired.length === 0) return;

  paymentLogger.info(`Expiring ${expired.length} overdue subscription(s)`);

  await Promise.all(
    expired.map(async (sub) => {
      await db.updateSubscription(sub.id!, { status: 'expired' });
      await db.updateUser(sub.user_id, { plan: 'free' });
      paymentLogger.info('Subscription expired — user downgraded to free', {
        userId: sub.user_id,
        plan:   sub.plan,
      });
    })
  );
}

// ── Razorpay webhook types ────────────────────────────────────────

interface RazorpayPaymentEntity {
  id:                 string;
  order_id:           string;
  amount:             number;
  currency:           string;
  status:             string;
  error_description?: string;
  notes?: {
    user_id?: string;
    email?:   string;
    plan?:    string;
  };
}

interface RazorpaySubscriptionEntity {
  id: string;
  notes?: {
    user_id?: string;
  };
}

interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?:      { entity: RazorpayPaymentEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
  };
}
