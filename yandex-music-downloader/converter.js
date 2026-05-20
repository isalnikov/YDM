/**
 * Offscreen Document: ffmpeg.wasm — конвертация M4A→MP3 + ID3 и обложка.
 */

(function () {
  'use strict';

  const { FFmpeg } = FFmpegWASM;
  let ffmpeg = null;
  let loading = null;
  let ffmpegQueue = Promise.resolve();

  function log(action, ...args) {
    console.log('[YM-EXT Offscreen]', action, ...args);
  }

  function sanitizeMeta(s) {
    return String(s)
      .replace(/[\r\n\0=;#\\]/g, ' ')
      .trim();
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function coverExtFromBuffer(buf) {
    const u = new Uint8Array(buf);
    if (u.length >= 8 && u[0] === 0x89 && u[1] === 0x50) return 'png';
    return 'jpg';
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   */
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
      instance.on('log', ({ message }) => {
        if (message && !message.includes('frame=')) log('ffmpeg', message);
      });
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

  async function safeDelete(ff, name) {
    try {
      await ff.deleteFile(name);
    } catch (_) {}
  }

  async function safeWrite(ff, name, data) {
    await safeDelete(ff, name);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await ff.writeFile(name, bytes);
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {string} inputExt
   * @param {string|null} coverB64
   * @param {{ title?: string, artist?: string, album?: string }} meta
   */
  async function convertToMp3(buffer, inputExt, coverB64, meta) {
    const ff = await loadFfmpeg();
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const inputName = `in_${id}.${inputExt || 'm4a'}`;
    const outputName = `out_${id}.mp3`;
    const hasCover = Boolean(coverB64);
    let coverName = null;

    return runExclusive(async () => {
      try {
        await safeWrite(ff, inputName, buffer);

        if (hasCover) {
          const coverBuf = base64ToArrayBuffer(coverB64);
          coverName = `cover_${id}.${coverExtFromBuffer(coverBuf)}`;
          await safeWrite(ff, coverName, coverBuf);
        }

        const args = ['-y', '-i', inputName];
        if (hasCover) {
          args.push('-i', coverName, '-map', '0:a:0', '-map', '1:0');
        }

        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
        if (hasCover) args.push('-c:v', 'copy');

        args.push('-id3v2_version', '3');
        if (meta?.title) args.push('-metadata', `title=${sanitizeMeta(meta.title)}`);
        if (meta?.artist) args.push('-metadata', `artist=${sanitizeMeta(meta.artist)}`);
        if (meta?.album) args.push('-metadata', `album=${sanitizeMeta(meta.album)}`);

        if (hasCover) {
          args.push(
            '-metadata:s:v',
            'title=Album cover',
            '-metadata:s:v',
            'comment=Cover (front)',
            '-disposition:v:0',
            'attached_pic'
          );
        }

        args.push(outputName);
        log('exec', args.join(' '));

        try {
          await ff.exec(args);
        } catch (execErr) {
          if (!hasCover) throw execErr;
          log('warn', 'конвертация с обложкой не удалась, без APIC', execErr);
          await safeDelete(ff, outputName);
          const simple = [
            '-y',
            '-i',
            inputName,
            '-codec:a',
            'libmp3lame',
            '-q:a',
            '2',
            '-id3v2_version',
            '3'
          ];
          if (meta?.title) simple.push('-metadata', `title=${sanitizeMeta(meta.title)}`);
          if (meta?.artist) simple.push('-metadata', `artist=${sanitizeMeta(meta.artist)}`);
          if (meta?.album) simple.push('-metadata', `album=${sanitizeMeta(meta.album)}`);
          simple.push(outputName);
          await ff.exec(simple);
        }

        const out = await ff.readFile(outputName);
        const outBytes = out instanceof Uint8Array ? out : new Uint8Array(out);
        return { buffer: outBytes.buffer, ext: 'mp3' };
      } finally {
        await safeDelete(ff, inputName);
        await safeDelete(ff, outputName);
        if (coverName) await safeDelete(ff, coverName);
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen') return false;
    if (message?.type !== 'CONVERT_AUDIO') return false;

    (async () => {
      try {
        let audioBuffer = message.buffer;
        if (!audioBuffer && message.bufferB64) {
          audioBuffer = base64ToArrayBuffer(message.bufferB64);
        }
        if (!audioBuffer) {
          throw new Error('Нет аудио-буфера для конвертации');
        }

        const result = await convertToMp3(
          audioBuffer,
          message.inputExt || 'm4a',
          message.coverB64 || null,
          message.meta || {}
        );

        const blob = new Blob([new Uint8Array(result.buffer)]);
        const outputB64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const data = r.result;
            resolve(typeof data === 'string' ? data.split(',')[1] : '');
          };
          r.onerror = () => reject(r.error || new Error('FileReader'));
          r.readAsDataURL(blob);
        });

        await chrome.runtime.sendMessage({
          type: 'CONVERT_RESULT',
          requestId: message.requestId,
          ok: true,
          outputB64,
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
