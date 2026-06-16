import { Router } from 'express';
import { authMiddleware, requireVerified, validate } from '../../core/middleware';
import { getMe, getReferral, saveOnboarding } from './user.controller';
import { OnboardingSchema } from '../../core/utils/schemas';

const router = Router();

// /me must NOT have requireVerified — unverified users need to reach this
// endpoint so the frontend can read email_verified: false and show the
// verification banner. requireVerified stays on AI/session routes only.
router.get('/me',       authMiddleware, getMe);
router.get('/referral', authMiddleware, requireVerified, getReferral);
router.post('/onboarding', authMiddleware, validate(OnboardingSchema), saveOnboarding);

export default router;
