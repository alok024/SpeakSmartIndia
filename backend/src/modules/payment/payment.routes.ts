import { Router } from 'express';
import * as PaymentController from './payment.controller';
import { authMiddleware, requireVerified, validate, asyncHandler } from '../../core/middleware';
import { CreateOrderSchema, VerifyPaymentSchema } from '../../core/utils/schemas';

const router = Router();

// POST /api/payment/create-order
// Fix 3: requireVerified — only verified users can initiate payments
router.post('/create-order',
  authMiddleware,
  requireVerified,
  validate(CreateOrderSchema),
  asyncHandler(PaymentController.createOrder)
);

// POST /api/payment/verify
router.post('/verify',
  authMiddleware,
  requireVerified,
  validate(VerifyPaymentSchema),
  asyncHandler(PaymentController.verifyPayment)
);

// POST /api/payment/webhook
// No auth middleware — Razorpay signature validates it.
// Also registered directly in app.ts BEFORE express.json() with raw body.
router.post('/webhook',
  asyncHandler(PaymentController.webhook)
);

export default router;
