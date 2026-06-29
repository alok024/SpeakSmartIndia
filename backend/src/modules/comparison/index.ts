export { default } from './comparison.routes';
export { encodeComparisonToken, decodeComparisonToken, createComparison, getPublicComparison, submitChallengeResponse } from './comparison.service';
export type { PublicComparison, ChallengeSubmitResult } from './comparison.service';
