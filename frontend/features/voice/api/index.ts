/**
 * features/voice/api/index.ts
 *
 * HTTP calls for text-to-speech playback during live interview sessions.
 *
 * Returns a Blob directly rather than going through `apiCall`/ApiResult,
 * since the response is audio, not JSON.
 */
export const voiceApi = {
  tts: async (text: string): Promise<Blob | null> => {
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  },
};
