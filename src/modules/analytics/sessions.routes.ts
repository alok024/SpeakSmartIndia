import { Router } from 'express';
import { authMiddleware } from '../../core/middleware';
import {
  createSession,
  getSessions,
  getSession,
  scoreHistory,
} from './sessions.controller';
import { getShareToken } from '../reports/reports.routes';

const router = Router();

router.post('/',               authMiddleware, createSession);
router.get('/',                authMiddleware, getSessions);
router.get('/score-history',   authMiddleware, scoreHistory);    // must be BEFORE /:id
router.get('/:id/share-token', authMiddleware, getShareToken);   // share link generator
router.get('/:id',             authMiddleware, getSession);

export default router;
