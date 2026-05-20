/**
 * Service Worker — API, скачивание, конвертация.
 */

const API_BASE = 'https://api.music.yandex.net';
const MD5_SECRET = 'XGRlBW9FXlekgbPrRHuSiA';
const SIGN_DOWNLOAD_INFO = 'p93jhgh689SBReK6ghtw62';
const SIGN_GET_FILE_INFO = 'kzqU4XhfCaY6B6JTHODeq5';
const CLIENT_HEADER = 'YandexMusicAndroid/24023621';
const OAUTH_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';

/** @type {boolean} */
let offscreenCreating = false;

/**
 * @param {'log'|'warn'|'error'|'info'} level
 * @param {string} action
 * @param {...unknown} details
 */
function log(level, action, ...details) {
  const msg = details.length ? [action, ...details] : [action];
  console[level]('[YM-EXT SW]', ...msg);
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'track';
}

/**
 * @param {ArrayBuffer} buffer
 */
async function arrayBufferToBase64(buffer) {
  const blob = new Blob([new Uint8Array(buffer)]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('base64 encode failed'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {string} b64
 */
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Обложка со страницы (img в строке трека).
 * @param {string|null|undefined} coverUrl
 */
async function fetchCoverFromPage(coverUrl) {
  if (!coverUrl) return null;
  log('log', 'обложка со страницы', coverUrl.slice(0, 90));
  try {
    const res = await fetch(coverUrl);
    if (!res.ok) {
      log('warn', 'обложка HTTP', res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 50) return null;
    log('log', 'обложка загружена', Math.round(buf.byteLength / 1024) + ' KB');
    return buf;
  } catch (e) {
    log('warn', 'обложка не загружена', e);
    return null;
  }
}

/** MD5 для подписи URL (как в веб-клиенте Яндекс.Музыки). */
function md5(string) {
  function cmn(q, a, b, x, s, t) {
    a = (((a + q) | 0) + ((x + t) | 0)) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5cycle(x, k) {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = (a + x[0]) | 0;
    x[1] = (b + x[1]) | 0;
    x[2] = (c + x[2]) | 0;
    x[3] = (d + x[3]) | 0;
  }
  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] =
        s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  const x = [1732584193, -271733879, -1732584194, 271733878];
  let k;
  let remaining = unescape(encodeURIComponent(string));
  const len = remaining.length;
  let i;
  for (i = 64; i <= remaining.length; i += 64) {
    k = md5blk(remaining.substring(i - 64, i));
    md5cycle(x, k);
  }
  remaining = remaining.substring(i - 64);
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (i = 0; i < remaining.length; i++) tail[i >> 2] |= remaining.charCodeAt(i) << (i % 4 << 3);
  tail[i >> 2] |= 0x80 << (i % 4 << 3);
  if (i > 55) {
    md5cycle(x, tail);
    for (i = 0; i < 16; i++) tail[i] = 0;
  }
  tail[14] = len * 8;
  md5cycle(x, tail);
  const hex = '0123456789abcdef';
  let out = '';
  for (i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out += hex.charAt((x[i] >> (j * 8 + 4)) & 0x0f) + hex.charAt((x[i] >> (j * 8)) & 0x0f);
    }
  }
  return out;
}

/**
 * HMAC-SHA256 → base64 (обрезаем последний символ как в клиенте Яндекса).
 * @param {string} key
 * @param {string} message
 * @returns {Promise<string>}
 */
/**
 * @param {string} key
 * @param {string} message
 * @param {boolean} [trimLastChar] — для /get-file-info убирается последний символ подписи
 */
async function hmacSha256Base64(key, message, trimLastChar = false) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  let b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (trimLastChar) b64 = b64.slice(0, -1);
  return b64;
}

/**
 * @param {string} code
 * @returns {string}
 */
function mapApiErrorMessage(code) {
  const map = {
    'no-rights': 'Нет прав на скачивание этого трека (трек недоступен, регион или нет подписки Плюс).',
    'not-allowed': 'Скачивание запрещено для вашего аккаунта.',
    'not-found': 'Трек не найден.',
    'forbidden': 'Доступ запрещён.'
  };
  return map[code] || `Ошибка API: ${code}`;
}

/**
 * @param {unknown} json
 * @returns {unknown}
 */
function unwrapApiResult(json) {
  if (!json || typeof json !== 'object') return json;
  const r = json.result;
  if (r && typeof r === 'object' && !Array.isArray(r) && r.message) {
    throw new Error(mapApiErrorMessage(String(r.message)));
  }
  if ('result' in json) return json.result;
  return json;
}

async function ensureOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('converter.html')]
    });
    if (existing.length > 0) return;
  }
  if (offscreenCreating) {
    await new Promise((r) => setTimeout(r, 500));
    return ensureOffscreenDocument();
  }
  offscreenCreating = true;
  try {
    await chrome.offscreen.createDocument({
      url: 'converter.html',
      reasons: ['WORKERS'],
      justification: 'Конвертация аудио в MP3'
    });
    log('log', 'offscreen document создан');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/exists|only a single/i.test(msg)) throw err;
  } finally {
    offscreenCreating = false;
  }
}

/**
 * @param {string} path
 * @param {string} token
 * @param {Record<string, string>} [params]
 */
async function apiFetch(path, token, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  log('log', 'API запрос', url.pathname + url.search);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `OAuth ${token}`,
      Accept: 'application/json',
      'X-Yandex-Music-Client': CLIENT_HEADER
    }
  });
  log('log', 'API ответ', res.status, url.pathname);

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const nested = json?.result;
    const apiCode = typeof nested === 'object' && nested?.message ? String(nested.message) : '';
    const errMsg =
      (apiCode && mapApiErrorMessage(apiCode)) ||
      json?.error?.message ||
      json?.errorDescription ||
      (typeof json?.error === 'string' ? json.error : '') ||
      text.slice(0, 200) ||
      `HTTP ${res.status}`;

    log('error', 'API ошибка', {
      status: res.status,
      path: url.pathname,
      apiCode,
      body: text.slice(0, 400)
    });

    if (res.status === 401) {
      throw new Error('Токен недействителен (401). Получите новый: popup → «Получить токен».');
    }
    throw new Error(`API ${res.status}: ${errMsg}`);
  }

  try {
    return unwrapApiResult(json);
  } catch (e) {
    log('error', 'unwrapApiResult', e);
    throw e;
  }
}

/**
 * Прямая ссылка из XML (формат библиотеки yandex-music-api).
 * @param {string} xmlText
 */
function buildMp3UrlFromXml(xmlText) {
  const get = (tag) => {
    const m = xmlText.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return m ? m[1].trim() : '';
  };
  const host = get('host');
  const path = get('path');
  const ts = get('ts');
  const s = get('s');
  if (!host || !path) throw new Error('Пустой XML downloadInfo');
  if (path.startsWith('http')) return path;
  const hash = md5(MD5_SECRET + path.substring(1) + s);
  return `https://${host}/get-mp3/${hash}/${ts}${path}`;
}

/**
 * @param {Record<string, string>} fields
 */
function buildMp3UrlFromFields(fields) {
  const { host, path, ts, s } = fields;
  if (!host || !path) throw new Error('Нет host/path в meta');
  if (path.startsWith('http')) return path;
  const hash = md5(MD5_SECRET + path.substring(1) + (s || ''));
  return `https://${host}/get-mp3/${hash}/${ts}${path}`;
}

/**
 * @param {string} infoUrl
 * @param {string} token
 */
async function fetchDownloadMetaAndBuildUrl(infoUrl, token) {
  const isNewEncrypted = /api\.music\.yandex\.net\/get-mp3\//i.test(infoUrl);
  let fetchUrl = infoUrl;
  if (!isNewEncrypted && !fetchUrl.includes('format=json')) {
    fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'format=json';
  }

  log('log', 'загрузка meta', fetchUrl.slice(0, 100));

  const res = await fetch(fetchUrl, {
    headers: token ? { Authorization: `OAuth ${token}` } : {}
  });
  const text = await res.text();
  log('log', 'meta ответ', res.status, res.headers.get('content-type'), text.length);

  if (!res.ok) {
    log('error', 'meta fetch fail', text.slice(0, 300));
    throw new Error(`meta ${res.status}: ${text.slice(0, 120)}`);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      return buildMp3UrlFromFields({
        host: j.host,
        path: j.path,
        ts: j.ts,
        s: j.s
      });
    } catch (e) {
      log('error', 'JSON meta parse', e);
    }
  }

  return buildMp3UrlFromXml(text);
}

/**
 * @param {Array<Record<string, unknown>>} list
 */
function pickDownloadInfoItem(list) {
  const items = Array.isArray(list) ? list : [];
  const isXmlMp3 = (i) =>
    i.codec === 'mp3' &&
    !i.preview &&
    i.downloadInfoUrl &&
    !String(i.downloadInfoUrl).includes('.m3u8') &&
    i.container !== 'hls';

  const mp3 = items.filter(isXmlMp3).sort((a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0));
  if (mp3.length) return mp3[0];

  const legacy = items.filter(
    (i) => i.downloadInfoUrl && !String(i.downloadInfoUrl).includes('.m3u8') && i.container !== 'hls'
  );
  if (legacy.length) return legacy[0];

  const anyMp3 = items.filter((i) => i.codec === 'mp3' && !i.preview);
  if (anyMp3.length) return anyMp3[0];

  return items[0] || null;
}

/**
 * download-info с подписью (актуальный API).
 * @param {string} trackId
 * @param {string} token
 */
async function fetchDownloadInfoList(trackId, token) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await hmacSha256Base64(SIGN_DOWNLOAD_INFO, `${trackId}${ts}`);

  let list = await apiFetch(`/tracks/${trackId}/download-info`, token, {
    can_use_streaming: 'true',
    ts: String(ts),
    sign
  });

  if (Array.isArray(list) && list.length) {
    log('log', 'download-info (signed)', list.length, 'вариантов');
    return list;
  }

  log('warn', 'signed download-info пуст — пробуем legacy');
  list = await apiFetch(`/tracks/${trackId}/download-info`, token, {
    can_use_streaming: 'false'
  });
  log('log', 'download-info (legacy)', Array.isArray(list) ? list.length : 0);
  return list;
}

/**
 * @param {string} trackId
 * @param {string} token
 */
async function resolveFromDownloadInfo(trackId, token) {
  const infoList = await fetchDownloadInfoList(trackId, token);
  if (!Array.isArray(infoList) || !infoList.length) {
    throw new Error('API не вернул варианты download-info');
  }

  const best = pickDownloadInfoItem(infoList);
  if (!best?.downloadInfoUrl) {
    throw new Error('Только HLS-поток — нужен OAuth и подписка Плюс. Получите токен в popup.');
  }

  log('log', 'выбран формат', best.codec, best.bitrateInKbps, best.container, String(best.downloadInfoUrl).slice(0, 60));

  const url = await fetchDownloadMetaAndBuildUrl(String(best.downloadInfoUrl), token);
  log('log', 'итоговая MP3 ссылка', url.slice(0, 90) + '…');
  return { url, codec: best.codec || 'mp3' };
}

/**
 * Новый API /get-file-info (MP3).
 * @param {string} trackId
 * @param {string} token
 */
async function resolveFromGetFileInfo(trackId, token) {
  const attempts = [
    { quality: 'hq', codecs: 'mp3', transports: 'raw' },
    { quality: 'nq', codecs: 'mp3', transports: 'raw' },
    { quality: 'lossless', codecs: 'mp3', transports: 'raw' }
  ];

  for (const att of attempts) {
    const ts = Math.floor(Date.now() / 1000);
    const signPayload = `${ts}${trackId}${att.quality}${att.codecs.replace(/,/g, '')}${att.transports}`;
    const sign = await hmacSha256Base64(SIGN_GET_FILE_INFO, signPayload, true);

    log('log', 'get-file-info попытка', att.quality, att.codecs);

    const result = await apiFetch('/get-file-info', token, {
      ts: String(ts),
      trackId: String(trackId),
      quality: att.quality,
      codecs: att.codecs,
      transports: att.transports,
      sign
    });

    const info = result?.downloadInfo || result?.download_info || result;
    const directUrl = info?.url || info?.urls?.[0];
    if (directUrl && !String(directUrl).includes('.m3u8')) {
      log('log', 'get-file-info OK', att.quality, directUrl.slice(0, 80) + '…');
      return { url: directUrl, codec: info?.codec || 'mp3' };
    }
  }

  throw new Error('get-file-info не вернул MP3 URL');
}

/**
 * @param {string} trackId
 * @param {string} token
 */
async function resolveTrackUrl(trackId, token) {
  if (!token) {
    throw new Error(
      'Нужен OAuth-токен. Откройте popup расширения → «Получить токен» → войдите в Яндекс → скопируйте access_token из адресной строки.'
    );
  }

  const errors = [];

  try {
    return await resolveFromDownloadInfo(trackId, token);
  } catch (e) {
    errors.push(`download-info: ${e instanceof Error ? e.message : e}`);
    log('warn', errors[errors.length - 1]);
  }

  try {
    return await resolveFromGetFileInfo(trackId, token);
  } catch (e) {
    errors.push(`get-file-info: ${e instanceof Error ? e.message : e}`);
    log('warn', errors[errors.length - 1]);
  }

  throw new Error(
    `Не удалось получить ссылку на трек.\n${errors.join('\n')}\n\nПолучите OAuth-токен: popup → «Получить токен».`
  );
}

async function fetchAudioBuffer(url) {
  log('log', 'скачивание аудио…', url.slice(0, 100));
  const res = await fetch(url, { credentials: 'include' });
  log('log', 'аудио ответ', res.status, res.headers.get('content-type'));
  if (!res.ok) throw new Error(`Загрузка аудио: ${res.status}`);
  const mime = res.headers.get('content-type') || 'audio/mpeg';
  const buffer = await res.arrayBuffer();
  log('log', 'аудио получено', Math.round(buffer.byteLength / 1024) + ' KB');
  return { buffer, mime };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} inputExt
 * @param {{ title: string, artist: string, album?: string }} meta
 * @param {ArrayBuffer|null} coverBuffer
 */
async function convertInOffscreen(buffer, inputExt, meta, coverBuffer) {
  log('log', 'конвертация в MP3…', { hasCover: Boolean(coverBuffer) });
  await ensureOffscreenDocument();
  const requestId = crypto.randomUUID();
  const payload = {
    type: 'CONVERT_AUDIO',
    target: 'offscreen',
    requestId,
    buffer,
    inputExt,
    meta: {
      title: meta.title || '',
      artist: meta.artist || '',
      album: meta.album || ''
    }
  };
  if (coverBuffer && coverBuffer.byteLength > 0) {
    payload.coverB64 = await arrayBufferToBase64(coverBuffer);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Таймаут конвертации (120 с)'));
    }, 120000);
    function listener(message) {
      if (message?.type !== 'CONVERT_RESULT' || message.requestId !== requestId) return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      if (!message.ok) {
        reject(new Error(message.error || 'Ошибка конвертации'));
        return;
      }
      const outBuffer = message.outputB64
        ? base64ToArrayBuffer(message.outputB64)
        : message.buffer;
      if (!outBuffer) {
        reject(new Error('Пустой результат конвертации'));
        return;
      }
      resolve({ buffer: outBuffer, ext: message.ext || 'mp3' });
    }
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage(payload).catch(reject);
  });
}

/**
 * Прямое скачивание по HTTP(S) — работает в Service Worker (без createObjectURL).
 * @param {string} fileUrl
 * @param {string} filename
 */
async function downloadDirectUrl(fileUrl, filename) {
  log('log', 'chrome.downloads по URL', filename, fileUrl.slice(0, 90) + '…');
  const downloadId = await chrome.downloads.download({
    url: fileUrl,
    filename,
    conflictAction: 'uniquify',
    saveAs: false
  });
  log('log', 'chrome.downloads id', downloadId);
  return downloadId;
}

/**
 * Сохранение через chrome.downloads в Service Worker (data URL).
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @param {string} mime
 */
async function saveDownloadBuffer(buffer, filename, mime) {
  log('log', 'сохранение (SW)', filename, Math.round(buffer.byteLength / 1024) + ' KB');
  const b64 = await arrayBufferToBase64(buffer);
  const dataUrl = `data:${mime || 'audio/mpeg'};base64,${b64}`;
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: 'uniquify',
    saveAs: false
  });
  log('log', 'chrome.downloads id', downloadId);
  return downloadId;
}

async function notifyError(message) {
  log('error', 'уведомление', message);
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'YM Downloader',
      message: message.slice(0, 240)
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {string|null} token
 */
async function resolveToken(token) {
  if (token) {
    log('log', 'токен из сообщения');
    return token.replace(/^OAuth\s+/i, '').trim();
  }
  const data = await chrome.storage.local.get('oauthToken');
  if (data.oauthToken) {
    log('log', 'токен из storage');
    return String(data.oauthToken).replace(/^OAuth\s+/i, '').trim();
  }
  log('warn', 'OAuth токен отсутствует');
  return null;
}

async function downloadTrack({ trackId, title, artist, coverUrl, token }) {
  log('info', '═══ скачивание начато ═══', { trackId, title, artist, coverUrl: coverUrl?.slice(0, 60) });

  const oauth = await resolveToken(token);
  if (!oauth) {
    throw new Error(
      'OAuth-токен не найден. Popup расширения → «Получить токен» → авторизация → вставьте access_token. Cookies без токена больше не работают (API Яндекса изменился).'
    );
  }

  let resolvedTitle = title;
  let resolvedArtist = artist;

  let track = null;
  try {
    let trackMeta;
    try {
      trackMeta = await apiFetch(`/tracks/${trackId}`, oauth);
    } catch (e) {
      log('warn', '/tracks/{id} fail, пробуем trackIds', e);
      trackMeta = await apiFetch(`/tracks?trackIds=${trackId}`, oauth);
    }
    track = Array.isArray(trackMeta) ? trackMeta[0] : trackMeta;
    resolvedTitle = track?.title || title;
    resolvedArtist = track?.artists?.map((a) => a.name).join(', ') || artist;
    log('log', 'метаданные', {
      title: resolvedTitle,
      available: track?.available,
      availableForPremiumUsers: track?.availableForPremiumUsers
    });

    if (track && track.available === false) {
      throw new Error(
        `Трек «${resolvedTitle}» недоступен для скачивания (available=false). Попробуйте другой трек или проверьте подписку Плюс.`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('недоступен')) throw e;
    log('warn', 'метаданные не получены', e);
  }

  const { url, codec } = await resolveTrackUrl(trackId, oauth);
  const baseName = sanitizeFilename(`${resolvedArtist} - ${resolvedTitle}`);
  const isMp3 =
    codec === 'mp3' || /\/get-mp3\//i.test(url) || /\.mp3(\?|$)/i.test(url);

  if (isMp3) {
    const filename = `YandexMusic/${baseName}.mp3`;
    await downloadDirectUrl(url, filename);
    log('info', '═══ трек скачан (прямой URL) ═══', filename);
    return { ok: true, filename };
  }

  log('log', 'не MP3 — загрузка и конвертация', codec);
  const { buffer, mime } = await fetchAudioBuffer(url);
  const inputExt = mime.includes('mpeg') ? 'mp3' : 'm4a';

  let outBuffer = buffer;
  let outExt = inputExt;
  let outMime = mime;

  if (inputExt !== 'mp3') {
    try {
      const coverBuffer = await fetchCoverFromPage(coverUrl);
      const albumTitle = track?.albums?.[0]?.title || '';
      const converted = await convertInOffscreen(
        buffer,
        inputExt,
        { title: resolvedTitle, artist: resolvedArtist, album: albumTitle },
        coverBuffer
      );
      outBuffer = converted.buffer;
      outExt = 'mp3';
      outMime = 'audio/mpeg';
      log('log', 'конвертация OK', coverBuffer ? 'с обложкой' : 'без обложки');
    } catch (e) {
      log('warn', 'конвертация не удалась, исходный формат', e);
      outExt = inputExt;
    }
  }

  const filename = `YandexMusic/${baseName}.${outExt}`;
  await saveDownloadBuffer(outBuffer, filename, outMime);

  log('info', '═══ трек скачан (buffer) ═══', filename);
  return { ok: true, filename };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'DOWNLOAD_TRACK') {
    log('log', 'сообщение DOWNLOAD_TRACK', message.trackId);
    downloadTrack(message)
      .then((r) => sendResponse(r))
      .catch(async (err) => {
        const error = err instanceof Error ? err.message : String(err);
        log('error', 'скачивание провалено', {
          trackId: message.trackId,
          error,
          stack: err instanceof Error ? err.stack : undefined
        });
        await notifyError(error);
        sendResponse({ ok: false, error });
      });
    return true;
  }

  if (message?.type === 'GET_STATUS') {
    chrome.storage.local.get(['oauthToken', 'downloadedTracks'], (data) => {
      sendResponse({
        hasToken: Boolean(data.oauthToken),
        downloadedCount: (data.downloadedTracks || []).length
      });
    });
    return true;
  }

  if (message?.type === 'SAVE_TOKEN') {
    const t = message.token?.replace(/^OAuth\s+/i, '').trim();
    chrome.storage.local.set({ oauthToken: t }, () => {
      log('log', 'токен сохранён вручную', t ? t.slice(0, 12) + '…' : 'пусто');
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ verboseLog: true });
  log('info', 'расширение установлено/обновлено');
});
