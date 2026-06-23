import { Router } from 'express';
import { authMiddleware, requireVerified } from '../../core/middleware';
import { handleListPrepPaths, handleEnroll, handleMyEnrollment } from './prep-paths.controller';

const router = Router();

// GET /api/prep-paths — catalog (auth required, same as the rest of the app's API)
router.get('/', authMiddleware, requireVerified, handleListPrepPaths);

// GET /api/prep-paths/my-enrollment
// (no path-param collision with '/:id/enroll' below since the HTTP
// methods differ, but kept above it for readability — most-specific first.)
router.get('/my-enrollment', authMiddleware, requireVerified, handleMyEnrollment);

// POST /api/prep-paths/:id/enroll
router.post('/:id/enroll', authMiddleware, requireVerified, handleEnroll);

export default router;
