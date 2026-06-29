export { default } from './elara.routes';
export { generateDebrief, generateAudit } from './elara.service';
export type { AnswerEntry, DebriefResult, AuditPattern, AuditResult } from './elara.service';
export { saveElaraSession, getElaraSessions, trackVocabErrors, saveWordManually, getVocabList, buildVocabSystemPrompt } from './elara-sessions.service';
export type { ElaraScores, VocabError } from './elara-sessions.service';
