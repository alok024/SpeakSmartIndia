import { Router } from 'express';
import { authMiddleware, requireVerified, validate } from '../../../core/middleware';
import { getMe, getReferral, saveOnboarding, saveDAF, getDAF, saveCompanyMode } from './profile.controller';
import { OnboardingSchema, DAFSchema, CompanyModeSchema } from '../../../core/utils/schemas';

const router = Router();

router.get('/me',       authMiddleware, getMe);
router.get('/referral', authMiddleware, requireVerified, getReferral);
router.post('/onboarding', authMiddleware, validate(OnboardingSchema), saveOnboarding);

// DAF — UPSC personalisation profile
router.get('/daf',  authMiddleware, requireVerified, getDAF);
router.post('/daf', authMiddleware, requireVerified, validate(DAFSchema), saveDAF);

// Company mode — campus interview personalisation
router.post('/company-mode', authMiddleware, requireVerified, validate(CompanyModeSchema), saveCompanyMode);

export default router;
