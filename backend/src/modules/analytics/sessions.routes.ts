import { Router } from 'express';
import { authMiddleware, requireVerified, requireOnboarded } from '../../core/middleware';
import {
  createSession,
  getSessions,
  getSession,
  scoreHistory,
} from './sessions.controller';
import { getShareToken } from '../reports/reports.routes';

const router = Router();

// requireOnboarded: sessions are meaningless without profession/goal context
router.post('/',               authMiddleware, requireVerified, requireOnboarded, createSession);
router.get('/',                authMiddleware, requireVerified, getSessions);
router.get('/score-history',   authMiddleware, requireVerified, scoreHistory);
router.get('/:id/share-token', authMiddleware, requireVerified, getShareToken);
router.get('/:id',             authMiddleware, requireVerified, getSession);

export default router;
