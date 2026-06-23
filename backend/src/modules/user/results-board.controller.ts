/**
 * modules/user/results-board.controller.ts
 *
 * POST /api/user/job-landed   — auth required. Records the win, optionally
 *                               upserts a Results Board row, returns OG URL.
 * GET  /api/user/results-board — public, no auth. Returns paginated board.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, badRequest, tooManyRequests } from '../../core/utils/response';
import { trackEvent } from '../analytics/events.service';
import { recordJobLanded, getResultsBoard } from './results-board.service';
import { db } from '../../core/database/client';

// POST /api/user/job-landed
// Body: { role, company?, displayName, showOnBoard }
export const submitJobLanded = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const {
    role,
    company,
    displayName,
    showOnBoard,
  } = req.body as {
    role?:         string;
    company?:      string;
    displayName?:  string;
    showOnBoard?:  boolean;
  };

  // Validate required fields
  if (!role || typeof role !== 'string' || role.trim().length === 0) {
    badRequest(res, 'role is required', 'missing_role');
    return;
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    badRequest(res, 'displayName is required', 'missing_display_name');
    return;
  }
  if (role.trim().length > 120) {
    badRequest(res, 'role must be 120 characters or fewer', 'role_too_long');
    return;
  }
  if (company && company.trim().length > 120) {
    badRequest(res, 'company must be 120 characters or fewer', 'company_too_long');
    return;
  }
  if (displayName.trim().length > 60) {
    badRequest(res, 'displayName must be 60 characters or fewer', 'display_name_too_long');
    return;
  }

  // Idempotency: if already submitted, still return OK with updated data.
  // Users may want to update their company/role without re-triggering.
  // We intentionally do NOT block re-submission — results-board.service
  // upserts on UNIQUE(user_id) so it's safe.

  // Guard: must have at least 1 completed session (sanity check only —
  // the dashboard hides the card at <5 sessions, but the API shouldn't
  // blindly trust client-side gating).
  const stats = await db.getStats(userId);
  if (!stats || (stats.sessions ?? 0) < 1) {
    tooManyRequests(res, 'Complete at least one interview session before submitting', 'no_sessions');
    return;
  }

  const result = await recordJobLanded({
    userId,
    role:        role.trim(),
    company:     company?.trim() || undefined,
    displayName: displayName.trim(),
    showOnBoard: showOnBoard === true,
  });

  trackEvent({
    event:  'job_landed',
    userId,
    path:   '/api/user/job-landed',
    properties: {
      role:          role.trim(),
      company:       company?.trim() ?? null,
      show_on_board: showOnBoard === true,
      sessions:      stats.sessions,
    },
  });

  ok(res, result);
});

// GET /api/user/results-board  (public — no auth middleware applied in routes)
// Query params: page (default 1), page_size (default 20, max 50)
export const getBoard = asyncHandler(async (req: Request, res: Response) => {
  const page     = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.page_size ?? '20'), 10) || 20));

  const board = await getResultsBoard(page, pageSize);
  ok(res, board);
});
