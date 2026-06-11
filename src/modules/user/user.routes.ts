import { Router } from 'express';
import { authMiddleware } from '../../core/middleware';
import { getMe, getReferral } from './user.controller';

const router = Router();

router.get('/me',       authMiddleware, getMe);
router.get('/referral', authMiddleware, getReferral);

export default router;
