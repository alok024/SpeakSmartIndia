import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { db } from '../../core/database/client';
import { LeadDTO } from '../../core/utils/schemas';
import { sendLeadEmails } from '../auth/email.service';
import { dispatchLeadFollowUp } from '../../infra/queue/dispatcher';
import { logger } from '../../infra/logger';
import { ok } from '../../core/utils/response';

const log = logger.child({ module: 'leads' });

// POST /api/leads
export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, org, size, orgType, message } = req.body as LeadDTO;

  // 1. Persist to DB — always happens, regardless of email success
  const lead = await db.createLead({ name, email, org, size, orgType, message });

  // 2. Fire notification + confirmation emails (non-fatal)
  sendLeadEmails({ name, email, org, size, orgType, message })
    .catch(err => log.warn('sendLeadEmails failed (non-fatal)', { email, org, error: (err as Error).message }));

  // 3. Schedule a 24h follow-up email if the team hasn't acted by then
  dispatchLeadFollowUp(lead.id)
    .catch(err => log.warn('dispatchLeadFollowUp failed (non-fatal)', { email, org, error: (err as Error).message }));

  ok(res, {});
});
