/**
 * features/payment/api/index.ts
 *
 * HTTP calls for the Razorpay checkout flow.
 */
import { apiCall } from '@/lib/api';
import type {
  CreateOrderResponse,
  VerifyPaymentPayload,
  VerifyPaymentResponse,
} from '../types';

export const paymentApi = {
  createOrder: (plan: 'pro' | 'elite') =>
    apiCall<CreateOrderResponse>('/payment/create-order', 'POST', { plan }),

  verifyPayment: (payload: VerifyPaymentPayload) =>
    apiCall<VerifyPaymentResponse>('/payment/verify', 'POST', payload),
};
