/**
 * Offscreen Document: ffmpeg.wasm — конвертация, ID3-теги, обложка (APIC).
 */

(function () {
  'use strict';

  const { FFmpeg } = FFmpegWASM;
  /** @type {import('@ffmpeg/ffmpeg').FFmpeg | null} */
  let ffmpeg = null;
  let loading = null;

  function log(action, ...args) {
    console.log('[YM-EXT Offscreen]', action, ...args);
  }

  /**
   * @param {string} s
 */
  function sanitizeMeta(s) {
    return String(s)
      .replace(/[\r\n\0]/g, ' ')
      .trim();
  }

  async function loadFfmpeg() {
    if (ffmpeg?.loaded) return ffmpeg;
    if (loading) return loading;

    loading = (async () => {
      const instance = new FFmpeg();
      const base = chrome.runtime.getURL('lib/');
      log('загрузка ffmpeg', base);
      await instance.load({
        coreURL: `${base}ffmpeg-core.js`,
        wasmURL: `${base}ffmpeg-core.wasm`
      });
      ffmpeg = instance;
      log('ffmpeg готов');
      return instance;
    })();

    return loading;
  }

  /**
   * Собирает MP3 с ID3v2 и встроенной обложкой (attached_pic).
   * @param {ArrayBuffer} audioBuffer
   * @param {string} inputExt
   * @param {ArrayBuffer|null} coverBuffer
   * @param {{ title?: string, artist?: string, album?: string, year?: string }} meta
   */
  async function processAudioWithTags(audioBuffer, inputExt, coverBuffer, meta) {
    const ff = await loadFfmpeg();
    const inputName = `input.${inputExt || 'mp3'}`;
    const outputName = 'output.mp3';
    const coverName = 'cover.jpg';

    await ff.writeFile(inputName, new Uint8Array(audioBuffer));

    const hasCover = coverBuffer && coverBuffer.byteLength > 0;
    if (hasCover) {
      await ff.writeFile(coverName, new Uint8Array(coverBuffer));
    }

    const args = ['-y', '-i', inputName];
    if (hasCover) {
      args.push('-i', coverName, '-map', '0:0', '-map', '1:0');
    } else {
      args.push('-map', '0:0');
    }

    if (inputExt === 'mp3') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-codec:a', 'libmp3lame', '-q:a', '2');
    }

    args.push('-id3v2_version', '3');

    if (meta?.title) args.push('-metadata', `title=${sanitizeMeta(meta.title)}`);
    if (meta?.artist) args.push('-metadata', `artist=${sanitizeMeta(meta.artist)}`);
    if (meta?.album) args.push('-metadata', `album=${sanitizeMeta(meta.album)}`);
    if (meta?.year) args.push('-metadata', `date=${sanitizeMeta(meta.year)}`);

    if (hasCover) {
      args.push(
        '-metadata:s:v',
        'title=Album cover',
        '-metadata:s:v',
        'comment=Cover (front)',
        '-disposition:v:0',
        'attached_pic'
      );
      log('вшиваем обложку APIC');
    } else {
      log('обложка отсутствует — только текстовые теги');
    }

    args.push(outputName);
    log('ffmpeg exec', args.join(' '));

    await ff.exec(args);
    const out = await ff.readFile(outputName);

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
    if (hasCover) await ff.deleteFile(coverName).catch(() => {});

    const outBytes = out instanceof Uint8Array ? out : new Uint8Array(out);
    return outBytes.buffer;
  }

  async function saveBlobDownload(buffer, filename) {
    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    log('создан blob URL для downloads', filename);
    try {
      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
      return downloadId;
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen') return false;

    if (message?.type === 'PROCESS_AUDIO') {
      (async () => {
        try {
          const outBuffer = await processAudioWithTags(
            message.buffer,
            message.inputExt || 'mp3',
            message.coverBuffer || null,
            message.meta || {}
          );
          const downloadId = await saveBlobDownload(outBuffer, message.filename);
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SAVED',
            requestId: message.requestId,
            ok: true,
            downloadId
          });
          sendResponse({ ok: true });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log('ошибка PROCESS_AUDIO', error);
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SAVED',
            requestId: message.requestId,
            ok: false,
            error
          });
          sendResponse({ ok: false, error });
        }
      })();
      return true;
    }

    if (message?.type === 'SAVE_DOWNLOAD') {
      (async () => {
        try {
          const downloadId = await saveBlobDownload(message.buffer, message.filename);
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SAVED',
            requestId: message.requestId,
            ok: true,
            downloadId
          });
          sendResponse({ ok: true });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log('ошибка сохранения', error);
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SAVED',
            requestId: message.requestId,
            ok: false,
            error
          });
          sendResponse({ ok: false, error });
        }
      })();
      return true;
    }

    return false;
  });

  log('offscreen старт');
})();
