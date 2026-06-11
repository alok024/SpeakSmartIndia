import { Router } from 'express';
import * as PaymentController from './payment.controller';
import { authMiddleware, validate, asyncHandler } from '../../core/middleware';
import { CreateOrderSchema, VerifyPaymentSchema } from '../../core/utils/schemas';

const router = Router();

// POST /api/payment/create-order
router.post('/create-order',
  authMiddleware,
  validate(CreateOrderSchema),
  asyncHandler(PaymentController.createOrder)
);

// POST /api/payment/verify
router.post('/verify',
  authMiddleware,
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
