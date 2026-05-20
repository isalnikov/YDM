/**
 * Offscreen: ffmpeg (M4A→MP3) + browser-id3-writer (APIC для Nautilus/Ubuntu).
 */
import { ID3Writer } from './lib/browser-id3-writer.mjs';

const { FFmpeg } = globalThis.FFmpegWASM;
let ffmpeg = null;
let loading = null;
let ffmpegQueue = Promise.resolve();

function log(action, ...args) {
  if (/ошибк|конвертац|теги|готово/i.test(action)) {
    console.log('[YM-EXT Offscreen]', action, ...args);
  }
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function runExclusive(fn) {
  const job = ffmpegQueue.then(() => fn());
  ffmpegQueue = job.catch(() => {});
  return job;
}

async function loadFfmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    const instance = new FFmpeg();
    const base = chrome.runtime.getURL('lib/');
    await instance.load({
      coreURL: `${base}ffmpeg-core.js`,
      wasmURL: `${base}ffmpeg-core.wasm`
    });
    ffmpeg = instance;
    return instance;
  })();
  return loading;
}

async function safeDelete(ff, name) {
  try {
    await ff.deleteFile(name);
  } catch (_) {}
}

async function safeWrite(ff, name, data) {
  await safeDelete(ff, name);
  await ff.writeFile(name, new Uint8Array(data));
}

/**
 * M4A → MP3 без тегов (теги — через ID3Writer).
 * @param {ArrayBuffer} buffer
 */
async function convertM4aToMp3(buffer) {
  const ff = await loadFfmpeg();
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const inputName = `in_${id}.m4a`;
  const outputName = `out_${id}.mp3`;

  return runExclusive(async () => {
    try {
      await safeWrite(ff, inputName, buffer);
      await ff.exec(['-y', '-i', inputName, '-codec:a', 'libmp3lame', '-q:a', '2', outputName]);
      const out = await ff.readFile(outputName);
      const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
      return bytes.buffer;
    } finally {
      await safeDelete(ff, inputName);
      await safeDelete(ff, outputName);
    }
  });
}

/**
 * ID3v2.3 + APIC (Cover front) — читается проводником Ubuntu.
 * @param {ArrayBuffer} mp3Buffer
 * @param {{ title?: string, artist?: string, album?: string }} meta
 * @param {ArrayBuffer|null} coverBuffer
 */
function tagMp3WithId3(mp3Buffer, meta, coverBuffer) {
  const writer = new ID3Writer(mp3Buffer);
  if (meta?.title) writer.setFrame('TIT2', meta.title);
  if (meta?.artist) {
    const artists = meta.artist.split(',').map((s) => s.trim()).filter(Boolean);
    writer.setFrame('TPE1', artists.length ? artists : [meta.artist]);
  }
  if (meta?.album) writer.setFrame('TALB', meta.album);

  if (coverBuffer && coverBuffer.byteLength > 0) {
    writer.setFrame('APIC', {
      type: 3,
      data: coverBuffer,
      description: ''
    });
  }

  writer.addTag();
  return writer.arrayBuffer;
}

function createBlobUrl(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}

function reply(requestId, ok, extra = {}) {
  return chrome.runtime.sendMessage({
    type: 'OFFSCREEN_RESULT',
    requestId,
    ok,
    ...extra
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  const { requestId, type } = message;

  (async () => {
    try {
      if (type === 'CONVERT_M4A') {
        log('конвертация', requestId);
        const audio = base64ToArrayBuffer(message.bufferB64);
        const mp3 = await convertM4aToMp3(audio);
        const blobUrl = createBlobUrl(mp3);
        await reply(requestId, true, { blobUrl });
        sendResponse({ ok: true });
        return;
      }

      if (type === 'TAG_MP3') {
        log('теги MP3', requestId, Boolean(message.coverB64));
        const audio = base64ToArrayBuffer(message.bufferB64);
        const cover = message.coverB64 ? base64ToArrayBuffer(message.coverB64) : null;
        const tagged = tagMp3WithId3(audio, message.meta || {}, cover);
        const blobUrl = createBlobUrl(tagged);
        log('готово', requestId);
        await reply(requestId, true, { blobUrl });
        sendResponse({ ok: true });
        return;
      }

      if (type === 'CONVERT_AND_TAG') {
        log('конвертация', requestId);
        const audio = base64ToArrayBuffer(message.bufferB64);
        let mp3 = await convertM4aToMp3(audio);
        log('теги MP3', requestId);
        const cover = message.coverB64 ? base64ToArrayBuffer(message.coverB64) : null;
        mp3 = tagMp3WithId3(mp3, message.meta || {}, cover);
        const blobUrl = createBlobUrl(mp3);
        log('готово', requestId);
        await reply(requestId, true, { blobUrl });
        sendResponse({ ok: true });
        return;
      }

      if (type === 'REVOKE_BLOB') {
        if (message.blobUrl) URL.revokeObjectURL(message.blobUrl);
        sendResponse({ ok: true });
        return;
      }

      throw new Error(`Неизвестная команда offscreen: ${type}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log('ошибка', type, error);
      await reply(requestId, false, { error });
      sendResponse({ ok: false, error });
    }
  })();

  return true;
});
