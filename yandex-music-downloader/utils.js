/**
 * Утилиты расширения. Логирование ВСЕГДА включено (log/warn/error).
 */

/** @type {string|null} */
let cachedOAuthToken = null;

/**
 * @param {'log'|'warn'|'error'|'info'} level
 * @param {string} action — краткое действие
 * @param {...unknown} details
 */
function LOG(level, action, ...details) {
  const key =
    /клик|скачивание|обложк|готово/i.test(action) || level === 'error' || level === 'warn';
  if (!key) return;
  const msg = details.length ? [action, ...details] : [action];
  const fn = level === 'info' ? console.info : console[level];
  fn('[YM-EXT]', ...msg);
}

/**
 * Debounce.
 * @param {(...args: unknown[]) => void} fn
 * @param {number} ms
 */
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'track';
}

/**
 * @param {string} href
 * @returns {string|null}
 */
function trackIdFromHref(href) {
  if (!href) return null;
  const m1 = href.match(/\/track\/(\d+)/);
  if (m1) return m1[1];
  const parts = href.split('/').filter(Boolean);
  const ti = parts.indexOf('track');
  if (ti >= 0 && parts[ti + 1]) return parts[ti + 1];
  return null;
}

/**
 * Похож ли на OAuth-токен Яндекса.
 * @param {string} str
 * @returns {boolean}
 */
function looksLikeYandexToken(str) {
  if (!str || typeof str !== 'string') return false;
  const t = str.replace(/^OAuth\s+/i, '').trim();
  if (t.length < 20 || t.length > 512) return false;
  return /^(y0_|y0__|AgAAAA|AQAAAA)/i.test(t) || /^[A-Za-z0-9._-]{20,}$/.test(t);
}

/**
 * localStorage + sessionStorage.
 * @returns {string|null}
 */
function extractAccessTokenFromStorage() {
  const storages = [localStorage, sessionStorage];
  const directKeys = [
    'accessToken',
    'oauthToken',
    'authToken',
    'token',
    'ym-auth-token',
    'yandexmusic:access_token'
  ];

  for (const storage of storages) {
    for (const key of directKeys) {
      try {
        const v = storage.getItem(key);
        if (looksLikeYandexToken(v)) return v.replace(/^OAuth\s+/i, '');
      } catch {
        /* ignore */
      }
    }

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      let raw = '';
      try {
        raw = storage.getItem(key) || '';
      } catch {
        continue;
      }

      try {
        const parsed = JSON.parse(raw);
        const nested = findTokenInObject(parsed, 0, new WeakSet());
        if (nested) return nested;
      } catch {
        /* not json */
      }

      if (/token|oauth|auth/i.test(key) && looksLikeYandexToken(raw)) {
        return raw.replace(/^OAuth\s+/i, '');
      }
    }
  }
  return null;
}

/**
 * @param {unknown} obj
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {string|null}
 */
function findTokenInObject(obj, depth, seen) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (seen.has(obj)) return null;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const t = findTokenInObject(item, depth + 1, seen);
      if (t) return t;
    }
    return null;
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && /token|oauth|access/i.test(key) && looksLikeYandexToken(val)) {
      return val.replace(/^OAuth\s+/i, '');
    }
    if (typeof val === 'object' && val !== null) {
      const t = findTokenInObject(val, depth + 1, seen);
      if (t) return t;
    }
  }
  return null;
}

/**
 * @param {string|null} token
 */
function setCachedToken(token) {
  if (token && looksLikeYandexToken(token)) {
    cachedOAuthToken = token.replace(/^OAuth\s+/i, '').trim();
    LOG('info', 'токен сохранён в кэш', cachedOAuthToken.slice(0, 12) + '…');
  }
}

/**
 * @returns {Promise<string|null>}
 */
async function getAccessToken() {
  if (cachedOAuthToken) {
    LOG('log', 'токен из кэша content');
    return cachedOAuthToken;
  }

  const fromStorage = extractAccessTokenFromStorage();
  if (fromStorage) {
    setCachedToken(fromStorage);
    LOG('log', 'токен из localStorage/sessionStorage');
    return cachedOAuthToken;
  }

  try {
    const data = await chrome.storage.local.get('oauthToken');
    if (looksLikeYandexToken(data.oauthToken)) {
      setCachedToken(data.oauthToken);
      LOG('log', 'токен из chrome.storage');
      return cachedOAuthToken;
    }
  } catch (e) {
    LOG('warn', 'ошибка чтения chrome.storage', e);
  }

  window.postMessage({ source: 'ym-ext-content', type: 'REQUEST_TOKEN' }, '*');
  LOG('log', 'запрошен токен у page-bridge');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      LOG('warn', 'токен не получен за 3с — будет сессия/cookies');
      resolve(cachedOAuthToken);
    }, 3000);

    function onMsg(e) {
      if (e.source !== window || e.data?.source !== 'ym-ext-bridge') return;
      if (e.data.type === 'TOKEN_FOUND') {
        setCachedToken(e.data.token);
        clearTimeout(timeout);
        window.removeEventListener('message', onMsg);
        LOG('log', 'токен от bridge', e.data.origin);
        resolve(cachedOAuthToken);
      }
      if (e.data.type === 'TOKEN_NOT_FOUND') {
        clearTimeout(timeout);
        window.removeEventListener('message', onMsg);
        LOG('warn', 'bridge: токен не найден');
        resolve(null);
      }
    }
    window.addEventListener('message', onMsg);
  });
}

function initBridgeListener() {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'ym-ext-bridge') return;
    if (e.data.type === 'TOKEN_FOUND') {
      setCachedToken(e.data.token);
      chrome.storage.local.set({ oauthToken: cachedOAuthToken }).catch(() => {});
      LOG('log', 'токен от page-bridge', e.data.origin);
    }
    if (e.data.type === 'API_CAPTURE') {
      LOG('log', 'перехвачен API-ответ', e.data.url?.split('?')[0]);
    }
  });
}

/**
 * Увеличивает превью avatars.yandex.net (100x100 → 400x400).
 * @param {string|null|undefined} url
 */
function normalizeCoverUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (u.startsWith('//')) u = `https:${u}`;
  u = u.replace(/%%/g, '400x400');
  u = u.replace(/\/(\d+)x(\d+)(?=$|[?#])/i, '/400x400');
  return u;
}

globalThis.YMUtils = {
  LOG,
  debounce,
  sanitizeFilename,
  normalizeCoverUrl,
  trackIdFromHref,
  extractAccessTokenFromStorage,
  getAccessToken,
  setCachedToken,
  initBridgeListener,
  looksLikeYandexToken
};
