import { Router } from 'express';
import { validate } from '../../core/middleware';
import { LeadSchema } from '../../core/utils/schemas';
import { createLead } from './leads.controller';

const router = Router();

// Public — B2B "Request a demo" form (no auth required)
router.post('/', validate(LeadSchema), createLead);

export default router;
