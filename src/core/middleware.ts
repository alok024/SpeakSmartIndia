import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z, ZodSchema } from 'zod';
import { env } from './config/env';
import { db } from './database/client';
import { PLAN_LIMITS, PlanType } from './config/env';
import { logger } from '../infra/logger';

const log = logger.child({ module: 'middleware' });

// ── JWT payload type ──────────────────────────────────────────────

export interface JWTPayload {
  id:    string;
  email: string;
  plan:  string;
  name:  string;
  jti?:  string;
  iat?:  number;
  exp?:  number;
}

declare global {
  namespace Express {
    interface Request {
      user?:      JWTPayload;
      callCount?: number;
    }
  }
}

// ── Auth middleware ───────────────────────────────────────────────

export async function authMiddleware(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const header = req.headers['authorization'];
  if (!header) { res.status(401).json({ error: 'No token provided' }); return; }

  const token = header.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    if (payload.jti) {
      try {
        const blacklisted = await db.isTokenBlacklisted(payload.jti);
        if (blacklisted) {
          res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
          return;
        }
      } catch {
        log.warn('Token blacklist check failed (non-fatal)', { jti: payload.jti });
      }
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Usage limit check ─────────────────────────────────────────────

export async function checkUsageLimit(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user  = req.user!;
  const plan  = user.plan as PlanType;
  const limit = PLAN_LIMITS[plan]?.ai_calls ?? 30;

  if (limit === -1) {
    try { req.callCount = (await db.getUsage(user.id))?.call_count ?? 0; } catch { req.callCount = 0; }
    next(); return;
  }

  try {
    const [dbUser, usage] = await Promise.all([db.getUserById(user.id), db.getUsage(user.id)]);
    const actualPlan  = (dbUser?.plan as PlanType) ?? plan;
    const actualLimit = PLAN_LIMITS[actualPlan]?.ai_calls ?? 30;
    const callCount   = usage?.call_count ?? 0;

    if (actualLimit !== -1 && callCount >= actualLimit) {
      res.status(403).json({
        error:      'limit_reached',
        message:    `You have used all ${actualLimit} AI calls for your ${actualPlan} plan.`,
        calls_used: callCount,
        limit:      actualLimit,
      });
      return;
    }

    req.callCount = callCount;
    next();
  } catch (err) {
    log.error('checkUsageLimit error', { error: err });
    next(err);
  }
}

// ── Zod validation middleware ─────────────────────────────────────

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.flatten().fieldErrors });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ── Async wrapper ─────────────────────────────────────────────────

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ── Global error handler ──────────────────────────────────────────

export function errorHandler(
  err: Error & { statusCode?: number },
  _req: Request, res: Response, _next: NextFunction
): void {
  const status  = err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';
  if (status >= 500) log.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(status).json({ error: message });
}
