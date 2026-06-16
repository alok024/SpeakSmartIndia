/**
 * features/payment/types/index.ts
 *
 * Types for the Razorpay checkout flow.
 * ReferralData primitive lives in @/types.
 */
import type { ReferralData } from '@/types';

/** POST /api/payment/order success body */
export interface CreateOrderResponse {
  order_id: string;
  amount:   number;
  currency: string;
  key:      string;
  plan:     string;
}

/** POST /api/payment/verify request body */
export interface VerifyPaymentPayload {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
  plan:                string;
}

/** POST /api/payment/verify success body */
export interface VerifyPaymentResponse {
  plan:     string;
  referral: ReferralData | null;
}
