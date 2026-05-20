/**
 * Offscreen Document: ленивая загрузка ffmpeg.wasm и конвертация в MP3.
 */

(function () {
  'use strict';

  const { FFmpeg } = FFmpegWASM;
  /** @type {import('@ffmpeg/ffmpeg').FFmpeg | null} */
  let ffmpeg = null;
  let loading = null;

  /**
   * @param {...unknown} args
   */
  function log(action, ...args) {
    console.log('[YM-EXT Offscreen]', action, ...args);
  }

  /**
   * Загружает ffmpeg.wasm из локальных файлов расширения.
   * @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>}
   */
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
   * Конвертирует аудио в MP3.
   * @param {ArrayBuffer} buffer
   * @param {string} inputExt
   * @returns {Promise<{ buffer: ArrayBuffer, ext: string }>}
   */
  async function convertToMp3(buffer, inputExt) {
    const ff = await loadFfmpeg();
    const inputName = `input.${inputExt || 'm4a'}`;
    const outputName = 'output.mp3';

    const data = new Uint8Array(buffer);
    await ff.writeFile(inputName, data);
    await ff.exec(['-i', inputName, '-codec:a', 'libmp3lame', '-q:a', '2', outputName]);
    const out = await ff.readFile(outputName);

    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});

    const outBytes = out instanceof Uint8Array ? out : new Uint8Array(out);
    return { buffer: outBytes.buffer, ext: 'mp3' };
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {string} filename
   * @param {string} mime
   */
  async function saveBlobDownload(buffer, filename, mime) {
    const blob = new Blob([buffer], { type: mime });
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

    if (message?.type === 'SAVE_DOWNLOAD') {
      (async () => {
        try {
          const downloadId = await saveBlobDownload(
            message.buffer,
            message.filename,
            message.mime || 'audio/mpeg'
          );
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

    if (message?.type !== 'CONVERT_AUDIO') return false;

    (async () => {
      try {
        const result = await convertToMp3(message.buffer, message.inputExt || 'm4a');
        await chrome.runtime.sendMessage({
          type: 'CONVERT_RESULT',
          requestId: message.requestId,
          ok: true,
          buffer: result.buffer,
          ext: result.ext
        });
        sendResponse({ ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log('ошибка конвертации', error);
        await chrome.runtime.sendMessage({
          type: 'CONVERT_RESULT',
          requestId: message.requestId,
          ok: false,
          error
        });
        sendResponse({ ok: false, error });
      }
    })();

    return true;
  });

  log('offscreen старт');
})();
