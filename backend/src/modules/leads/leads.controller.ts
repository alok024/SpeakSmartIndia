import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { LeadDTO } from '../../core/utils/schemas';
import { ok } from '../../core/utils/response';
import * as LeadsService from './leads.service';

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  await LeadsService.createLead(req.body as LeadDTO);
  ok(res, {});
});
