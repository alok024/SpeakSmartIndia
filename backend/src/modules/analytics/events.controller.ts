import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, badRequest } from '../../core/utils/response';
import { trackEvent, getFunnelSummary, getRecentEvents, STANDARD_FUNNEL_EVENTS } from './events.service';
import { AnalyticsEventBatchDTO, AdminEventQuerySchema } from '../../core/utils/schemas';

// POST /api/events
// Public ingestion endpoint (auth optional — works for logged-out funnels).
// Body: { events: [{ event, session_id?, path?, properties? }, ...] }
export const ingestEvents = asyncHandler(async (req: Request, res: Response) => {
  const { events } = req.body as AnalyticsEventBatchDTO;
  const requestingUser = req.user; // may be undefined for anonymous events

  for (const analyticsEvent of events) {
    trackEvent({
      event:      analyticsEvent.event,
      userId:     requestingUser?.id ?? null,
      sessionId:  analyticsEvent.session_id ?? null,
      path:       analyticsEvent.path ?? null,
      plan:       requestingUser?.plan ?? null,
      properties: analyticsEvent.properties ?? null,
    });
  }

  ok(res, { accepted: events.length });
});

// GET /api/admin/analytics/funnel?since=ISO&events=a,b,c
// Admin-only. Returns event counts in the given window.
export const getFunnel = asyncHandler(async (req: Request, res: Response) => {
  const sinceParam    = req.query.since as string | undefined;
  const sinceIso      = sinceParam
    ? new Date(sinceParam).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // default: last 7 days

  const eventsParam   = req.query.events as string | undefined;
  const eventNames    = eventsParam
    ? eventsParam.split(',').map(s => s.trim()).filter(Boolean)
    : [...STANDARD_FUNNEL_EVENTS];

  const funnelSummary = await getFunnelSummary(sinceIso, eventNames);
  ok(res, funnelSummary);
});

// GET /api/admin/analytics/events?limit=&event=&user_id=
// Admin-only. Raw recent event stream for debugging / drill-down.
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const parsed = AdminEventQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid query parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const { limit, event: eventName, user_id: userId } = parsed.data;
  const recentEvents = await getRecentEvents(limit, eventName, userId);
  ok(res, { events: recentEvents });
});
