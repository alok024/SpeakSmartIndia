/**
 * Audio encoder Web Worker
 *
 * Accepts a Float32Array of 16 kHz mono PCM samples from the VAD and
 * encodes them as a WAV blob entirely off the main thread. Keeps audio
 * encoding from blocking React renders or TTS playback.
 *
 * Message in:  { samples: Float32Array, sampleRate: number }
 * Message out: { wav: Blob } | { error: string }
 */

self.onmessage = function (e) {
  const { samples, sampleRate } = e.data;

  try {
    const wav = encodeWav(samples, sampleRate ?? 16000);
    self.postMessage({ wav }, [wav]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};

/**
 * Encode PCM Float32Array as a standard 16-bit PCM WAV.
 * Returns an ArrayBuffer (transferable — zero-copy back to the main thread).
 */
function encodeWav(samples, sampleRate) {
  const numChannels  = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign   = numChannels * bytesPerSample;
  const byteRate     = sampleRate * blockAlign;
  const dataBytes    = samples.length * bytesPerSample;
  const buffer       = new ArrayBuffer(44 + dataBytes);
  const view         = new DataView(buffer);

  // RIFF chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // sub-chunk size
  view.setUint16(20, 1,  true);           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate,  true);
  view.setUint32(28, byteRate,    true);
  view.setUint16(32, blockAlign,  true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // PCM samples: clamp Float32 → Int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
