/**
 * Prep Paths Service — Guided multi-day prep tracks (P6-A)
 *
 * A "prep path" is a fixed, multi-day curriculum (e.g. "Bank PO 7-Day Prep")
 * stored in `prep_paths` with its full day-by-day plan as JSONB. Enrolling a
 * user creates a row in `user_prep_enrollments` stamped with `enrolled_at`;
 * everything else (which day they're on, whether they've finished) is
 * derived at read-time from elapsed IST calendar days, not stored — so a
 * user who skips a day just sees themselves "behind schedule" on the next
 * day's content rather than getting silently fast-forwarded or stuck.
 */

import { AppError } from '../../core/utils/errors';
import { db, PrepPathRow, PrepPathDay, UserPrepEnrollmentRow } from '../../core/database/client';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Midnight-aligned IST calendar date, as a UTC timestamp (ms) — used so two
 *  timestamps on the same IST calendar day always diff to 0, regardless of
 *  time-of-day. */
function istCalendarDayMs(isoTimestamp: string): number {
  const istMs = new Date(isoTimestamp).getTime() + IST_OFFSET_MS;
  return Math.floor(istMs / 86_400_000) * 86_400_000;
}

export interface EnrollmentView {
  enrollment: UserPrepEnrollmentRow;
  path:       PrepPathRow;
  /** 1-indexed, capped at path.duration_days. */
  current_day:    number;
  today:          PrepPathDay;
  is_complete:    boolean;
}

export async function listPrepPaths(): Promise<PrepPathRow[]> {
  return db.getActivePrepPaths();
}

export async function enrollInPrepPath(userId: string, prepPathId: string): Promise<EnrollmentView> {
  const path = await db.getPrepPathById(prepPathId);
  if (!path) {
    throw new AppError(404, 'prep_path_not_found', 'That prep path does not exist.');
  }

  // Re-enrolling while an open enrollment exists just resumes it — keeps
  // the "Continue" flow idempotent if the enroll call fires twice (e.g.
  // a double-tap, or a retried request after a flaky connection).
  const existing = await db.getActivePrepEnrollment(userId);
  if (existing && existing.prep_path_id === prepPathId) {
    return buildEnrollmentView(existing, path);
  }
  if (existing) {
    // Switching paths — close out the old one so it doesn't keep showing
    // up as "active" alongside the new enrollment.
    await db.completePrepEnrollment(existing.id!);
  }

  const enrollment = await db.createPrepEnrollment(userId, prepPathId);
  return buildEnrollmentView(enrollment, path);
}

/** Returns the user's current enrollment (with today's day resolved), or null if not enrolled in anything. */
export async function getMyEnrollment(userId: string): Promise<EnrollmentView | null> {
  const enrollment = await db.getActivePrepEnrollment(userId);
  if (!enrollment) return null;

  const path = await db.getPrepPathById(enrollment.prep_path_id);
  if (!path) return null; // path was deactivated/removed after enrollment — treat as no active path

  return buildEnrollmentView(enrollment, path);
}

function buildEnrollmentView(enrollment: UserPrepEnrollmentRow, path: PrepPathRow): EnrollmentView {
  const elapsedDays = Math.floor(
    (istCalendarDayMs(new Date().toISOString()) - istCalendarDayMs(enrollment.enrolled_at!)) / 86_400_000
  );
  // Day 1 on the enrollment date itself; cap at the path's last day so a
  // user who finishes (or lapses past) the path still sees a valid day.
  const currentDay  = Math.min(Math.max(elapsedDays + 1, 1), path.duration_days);
  const isComplete  = elapsedDays + 1 > path.duration_days;
  const today        = path.days.find(d => d.day_number === currentDay) ?? path.days[path.days.length - 1];

  return {
    enrollment,
    path,
    current_day: currentDay,
    today,
    is_complete: isComplete,
  };
}
