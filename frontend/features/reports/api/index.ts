/**
 * features/reports/api/index.ts
 *
 * HTTP calls for the public shared-report page. No auth — these are
 * fetched by anonymous visitors who click a shared report link.
 */
import { apiCall } from '@/lib/api';
import type { PublicReportResponse } from '../types';

export const reportsApi = {
  getReport: (shareToken: string) =>
    apiCall<PublicReportResponse>(`/report/${shareToken}`),
};
