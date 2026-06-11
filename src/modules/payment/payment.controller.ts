import { Request, Response } from 'express';
import * as PaymentService from './payment.service';
import { paymentLogger } from '../../infra/logger';

// ── POST /api/payment/create-order ────────────────────────────────

export async function createOrder(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan: 'pro' | 'elite' };
  const user = req.user!;

  const order = await PaymentService.createOrder(user.id, user.email, plan);
  res.json(order);
}

// ── POST /api/payment/verify ──────────────────────────────────────
// Secondary activation path — runs client-side after payment modal closes.
// Webhook is the primary path. This handles the gap before webhook fires.

export async function verifyPayment(req: Request, res: Response): Promise<void> {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    plan,
  } = req.body as {
    razorpay_order_id:   string;
    razorpay_payment_id: string;
    razorpay_signature:  string;
    plan:                'pro' | 'elite';
  };

  const valid = PaymentService.verifySignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!valid) {
    paymentLogger.warn('Payment verify: signature mismatch', {
      userId:  req.user!.id,
      orderId: razorpay_order_id,
    });
    res.status(400).json({ error: 'Payment verification failed' });
    return;
  }

  // activateSubscription is idempotent — safe even if webhook already ran
  const newToken = await PaymentService.activateSubscription(
    req.user!.id,
    plan,
    razorpay_order_id,
    razorpay_payment_id
  );

  res.json({ success: true, token: newToken, plan });
}

// ── POST /api/payment/webhook ─────────────────────────────────────
// PRIMARY activation path. Registered in app.ts with raw body parser
// BEFORE express.json(). req.body is a raw Buffer here.

export async function webhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    res.status(400).json({ error: 'Missing webhook signature' });
    return;
  }

  try {
    await PaymentService.handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    paymentLogger.error('Webhook handling failed', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
}
