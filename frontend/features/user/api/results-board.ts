/**
 * features/user/api/results-board.ts
 *
 * HTTP calls for the Job Landed + Results Board feature.
 *
 * submitJobLanded — auth required (POST /api/user/job-landed)
 * getResultsBoard — public    (GET  /api/user/results-board)
 */

import { apiCall } from '@/lib/api';
import type { JobLandedInput, JobLandedResponse, ResultsBoardResponse } from '../types/results-board';

export const resultsBoardApi = {
  /**
   * Auth required. Records the job win, optionally opts the user into
   * the public Results Board. Returns an OG image URL for sharing.
   */
  submitJobLanded: (input: JobLandedInput) =>
    apiCall<JobLandedResponse>('/user/job-landed', 'POST', input),

  /**
   * Public — no auth required. Returns paginated Results Board entries.
   */
  getResultsBoard: (page = 1, pageSize = 20) =>
    apiCall<ResultsBoardResponse>(
      `/user/results-board?page=${page}&page_size=${pageSize}`
    ),
};
