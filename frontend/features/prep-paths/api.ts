
import { apiCall } from '@/lib/api';
import type { PrepPath, MyEnrollmentResponse, EnrollResponse } from './types';

export const prepPathsApi = {
  list: () => apiCall<{ paths: PrepPath[] }>('/prep-paths'),

  myEnrollment: () => apiCall<MyEnrollmentResponse>('/prep-paths/my-enrollment'),

  enroll: (prepPathId: string) =>
    apiCall<EnrollResponse>(`/prep-paths/${prepPathId}/enroll`, 'POST'),
};
