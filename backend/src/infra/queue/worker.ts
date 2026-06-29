// All handlers must be idempotent — BullMQ retries on failure.
// Concurrency = 5: scale by running more worker processes, not raising this.

import { Worker, Job }            from 'bullmq';
import { env }                    from '../../core/config/env';
import { QUEUE_NAME }             from './queues';
import { logger }                 from '../logger';
import { captureException }       from '../observability';
import { REDIS_CONNECTION_OPTIONS } from './redis';

const log = logger.child({ module: 'worker' });

export function startBackgroundWorker(): Worker | null {
  if (!env.REDIS_URL) {
    log.warn('Redis not configured — background worker not started');
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      log.debug('Processing job', { name: job.name, id: job.id, attempt: job.attemptsMade + 1 });

      switch (job.name) {

        case 'persist-mistakes': {
          const { persistMistakesFromFeedback } =
            await import('../../modules/ai/memory/memory.service');
          await persistMistakesFromFeedback(job.data.userId, job.data.topic, job.data.feedbacks);
          break;
        }

        case 'recompute-weak-areas': {
          const { recomputeWeakAreas } =
            await import('../../modules/analytics/reports/weak-areas.service');
          await recomputeWeakAreas(job.data.userId);
          break;
        }

        case 'generate-interviewer-notes': {
          const { generateInterviewerNotes } =
            await import('../../modules/analytics/reports/interviewer-notes.service');
          await generateInterviewerNotes(
            job.data.sessionId,
            job.data.profession,
            job.data.score,
            job.data.feedbacks
          );
          break;
        }

        case 'generate-readiness-report': {
          const { generateReadinessReport } =
            await import('../../modules/analytics/reports/readiness-report.service');
          await generateReadinessReport(job.data.userId, job.data.sessionCount);
          break;
        }

        case 'persist-analytics-events': {
          const { db } = await import('../../core/database/client');
          await db.createAnalyticsEvents(job.data.events);
          break;
        }

        case 'expire-subscriptions': {
          const { expireOverdueSubscriptions } =
            await import('../../modules/payment/payment.service');
          await expireOverdueSubscriptions();
          break;
        }

        case 'expire-stale-sessions': {
          const { expireStaleSessions } =
            await import('../../modules/analytics/sessions/sessions.service');
          await expireStaleSessions();
          break;
        }

        case 'lead-followup-email': {
          const { db }                    = await import('../../core/database/client');
          const { sendLeadFollowUpEmail } = await import('../../modules/auth/email.service');

          const lead = await db.getLeadById(job.data.leadId);
          if (!lead) {
            log.warn('lead-followup-email: lead not found', { leadId: job.data.leadId });
            break;
          }
          if (lead.status !== 'new') {
            log.debug('lead-followup-email: already actioned', { leadId: lead.id, status: lead.status });
            break;
          }

          await sendLeadFollowUpEmail({
            name:    lead.name,
            email:   lead.email,
            org:     lead.org,
            size:    lead.size,
            orgType: lead.org_type ?? undefined,
            message: lead.message ?? undefined,
          });

          // Conditional update guards against a status change between the read above and now.
          await db.updateLeadStatus(lead.id, 'contacted', 'new');
          break;
        }

        case 'weekly-progress-cards': {
          const { generateWeeklyProgressCards } =
            await import('../../modules/analytics/reports/weekly-card.service');
          await generateWeeklyProgressCards();
          break;
        }

        default:
          log.warn('Unknown job name — skipped', { name: job.name, id: job.id });
      }
    },
    {
      connection:  { ...REDIS_CONNECTION_OPTIONS, url: env.REDIS_URL },
      concurrency: 5,
    }
  );

  worker.on('completed', (job: Job) =>
    log.info('Job completed', { name: job.name, id: job.id, attempts: job.attemptsMade })
  );

  worker.on('failed', (job: Job | undefined, err: Error) => {
    const attempts  = job?.attemptsMade ?? 0;
    const exhausted = attempts >= 3;

    log.error('Job failed', { name: job?.name, id: job?.id, attempts, exhausted, error: err.message });

    if (exhausted) {
      captureException(err, {
        extra: { job_name: job?.name, job_id: job?.id, attempts, job_data: JSON.stringify(job?.data ?? {}) },
      });
    }
  });

  worker.on('error', (err: Error) =>
    log.error('Worker error', { error: err.message })
  );

  log.info('Background worker started', { queue: QUEUE_NAME, concurrency: 5 });
  return worker;
}
