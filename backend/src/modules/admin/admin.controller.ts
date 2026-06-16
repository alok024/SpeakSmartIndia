import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, badRequest, notFound } from '../../core/utils/response';
import {
  LEAD_STATUSES,
  UpdateLeadStatusDTO,
  AdminUsersQuerySchema,
  AdminLeadsQuerySchema,
  AdminSubscriptionsQuerySchema,
} from '../../core/utils/schemas';
import {
  getAdminOverview,
  getAdminUsers,
  getAdminRecentSubscriptions,
  getAdminLeads,
  updateAdminLeadStatus,
} from './admin.service';

// GET /api/admin/overview
export const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  const overview = await getAdminOverview();
  ok(res, overview);
});

// GET /api/admin/users?limit=&offset=&search=
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const parsed = AdminUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid query parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const { limit, offset, search } = parsed.data;
  const userPage = await getAdminUsers(limit, offset, search);
  ok(res, userPage);
});

// GET /api/admin/subscriptions?limit=
export const getSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  const parsed = AdminSubscriptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid query parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const recentSubscriptions = await getAdminRecentSubscriptions(parsed.data.limit);
  ok(res, { subscriptions: recentSubscriptions });
});

// GET /api/admin/leads?limit=&offset=&status=
export const getLeads = asyncHandler(async (req: Request, res: Response) => {
  const parsed = AdminLeadsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid query parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const { limit, offset, status } = parsed.data;
  // status is already validated by the enum in the schema — no manual check needed
  const leadsPage = await getAdminLeads(limit, offset, status);
  ok(res, leadsPage);
});

// PATCH /api/admin/leads/:id  { status }
export const updateLeadStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id: leadId } = req.params;
  const { status }     = req.body as UpdateLeadStatusDTO;

  const updatedLead = await updateAdminLeadStatus(leadId, status);
  if (!updatedLead) {
    notFound(res, 'Lead not found');
    return;
  }

  ok(res, { lead: updatedLead });
});
