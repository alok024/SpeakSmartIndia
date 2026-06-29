import { db } from '../../core/database/client';
import { LeadDTO } from '../../core/utils/schemas';
import { sendLeadEmails } from '../auth/email.service';
import { dispatchLeadFollowUp } from '../../infra/queue/dispatcher';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'leads' });

/**
 * Persists a B2B lead and fires non-fatal side effects: notification/
 * confirmation emails and a 24h follow-up reminder. Side effects are
 * intentionally fire-and-forget — a failure here must not fail the
 * lead-capture request itself.
 */
export async function createLead(payload: LeadDTO): Promise<{ id: string }> {
  const lead = await db.createLead(payload);

  sendLeadEmails(payload).catch(err =>
    log.warn('sendLeadEmails failed', { email: payload.email, org: payload.org, error: (err as Error).message }),
  );

  dispatchLeadFollowUp(lead.id).catch(err =>
    log.warn('dispatchLeadFollowUp failed', { email: payload.email, org: payload.org, error: (err as Error).message }),
  );

  return { id: lead.id };
}
