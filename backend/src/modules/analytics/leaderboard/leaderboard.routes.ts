import { Router } from 'express';
import { authMiddleware, requireVerified } from '../../../core/middleware';
import { getLeaderboard } from './leaderboard.controller';

const router = Router();

router.get('/', authMiddleware, requireVerified, getLeaderboard);

export default router;
