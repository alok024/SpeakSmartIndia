
import { apiCall } from '@/lib/api';
import type { PublicReportResponse } from './types';

export const reportsApi = {
  getReport: (shareToken: string) =>
    apiCall<PublicReportResponse>(`/report/${shareToken}`),
};
