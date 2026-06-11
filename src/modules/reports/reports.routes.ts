import { Router } from 'express';
import { authMiddleware } from '../../core/middleware';
import { getShareToken, getReport } from './reports.controller';

const router = Router();

// Public: GET /api/report/:shareToken
router.get('/:shareToken', getReport);

// Auth-required: GET /api/sessions/:id/share-token
// (registered under /api/sessions in app.ts)
export { getShareToken };

export default router;
