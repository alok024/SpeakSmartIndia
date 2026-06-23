import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, notFound } from '../../core/utils/response';
import { AppError } from '../../core/utils/errors';
import { listPrepPaths, enrollInPrepPath, getMyEnrollment } from './prep-paths.service';

// GET /api/prep-paths
// Public catalog of active guided prep paths — used by a "browse paths" page.
export const handleListPrepPaths = asyncHandler(async (_req: Request, res: Response) => {
  const paths = await listPrepPaths();
  ok(res, { paths });
});

// POST /api/prep-paths/:id/enroll
export const handleEnroll = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const prepPathId = req.params.id;

  try {
    const view = await enrollInPrepPath(userId, prepPathId);
    ok(res, { enrollment: view.enrollment, current_day: view.current_day, today: view.today });
  } catch (err) {
    if (err instanceof AppError && err.code === 'prep_path_not_found') {
      notFound(res, err.message);
      return;
    }
    throw err;
  }
});

// GET /api/prep-paths/my-enrollment
// Returns the dashboard's "Day 3 of 7 — Bank PO Prep" card data, or
// { enrollment: null } if the user isn't currently enrolled in anything.
export const handleMyEnrollment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const view = await getMyEnrollment(userId);

  if (!view) {
    ok(res, { enrollment: null });
    return;
  }

  ok(res, {
    enrollment: {
      id:           view.enrollment.id,
      enrolled_at:  view.enrollment.enrolled_at,
      prep_path_id: view.enrollment.prep_path_id,
    },
    path: {
      id:            view.path.id,
      title:         view.path.title,
      duration_days: view.path.duration_days,
    },
    current_day: view.current_day,
    is_complete: view.is_complete,
    today:       view.today,
  });
});
