import { Router } from 'express';
import { authMiddleware, requireAdmin, validate, validateUUIDParam } from '../../core/middleware';
import { getOverview, getUsers, getSubscriptions, getLeads, updateLeadStatus } from './admin.controller';
import { getFunnel, getEvents } from '../analytics/events.controller';
import { UpdateLeadStatusSchema } from '../../core/utils/schemas';

const router = Router();

router.use(authMiddleware, requireAdmin);

router.get('/overview',      getOverview);
router.get('/users',         getUsers);
router.get('/subscriptions', getSubscriptions);

// B2B leads
router.get('/leads',       getLeads);
router.patch('/leads/:id', validateUUIDParam('id'), validate(UpdateLeadStatusSchema), updateLeadStatus);

// Event tracking / funnel analytics
router.get('/analytics/funnel', getFunnel);
router.get('/analytics/events', getEvents);

export default router;
