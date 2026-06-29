export { default as aiRouter } from './chat/chat.routes';
export { callAI, streamAI } from './chat/chat.service';
export type { AIMessage, AIResponse } from './chat/chat.service';
export { persistMistakesFromFeedback, getUserMemoryContext } from './memory/memory.service';
export type { FeedbackItem, MistakeRecord } from './memory/memory.service';
