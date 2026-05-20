/**
 * Скрипт в MAIN world — перехват OAuth из fetch/XHR и URL hash.
 * Content script не видит заголовки страницы — только этот мост.
 */
(function () {
  'use strict';

  const SOURCE = 'ym-ext-bridge';
  let cachedToken = null;

  function looksLikeYandexToken(str) {
    if (!str || typeof str !== 'string') return false;
    const t = str.replace(/^OAuth\s+/i, '').trim();
    if (t.length < 20 || t.length > 512) return false;
    return /^(y0_|y0__|AgAAAA|AQAAAA)/i.test(t) || /^[A-Za-z0-9._-]{20,}$/.test(t);
  }

  function publishToken(token, origin) {
    if (!looksLikeYandexToken(token)) return;
    const clean = token.replace(/^OAuth\s+/i, '').trim();
    if (cachedToken === clean) return;
    cachedToken = clean;
    window.postMessage({ source: SOURCE, type: 'TOKEN_FOUND', token: clean, origin }, '*');
  }

  function scanHash() {
    const hash = window.location.hash || '';
    const m = hash.match(/access_token=([^&]+)/);
    if (m) publishToken(decodeURIComponent(m[1]), 'url-hash');
  }

  function deepFindToken(obj, depth, seen) {
    if (depth > 12 || !obj || typeof obj !== 'object') return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const f = deepFindToken(item, depth + 1, seen);
        if (f) return f;
      }
      return null;
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && /token|oauth|access/i.test(key) && looksLikeYandexToken(val)) {
        return val;
      }
      if (typeof val === 'object' && val !== null) {
        const f = deepFindToken(val, depth + 1, seen);
        if (f) return f;
      }
    }
    return null;
  }

  function scanGlobals() {
    const names = ['__INITIAL_STATE__', '__DATA__', '__PRELOADED_STATE__', 'ymusic', '_data'];
    for (const n of names) {
      try {
        if (window[n]) {
          const t = deepFindToken(window[n], 0, new WeakSet());
          if (t) publishToken(t, 'global:' + n);
        }
      } catch {
        /* ignore */
      }
    }
  }

  function extractAuthFromHeaders(headers) {
    if (!headers) return;
    let auth = null;
    if (headers instanceof Headers) {
      auth = headers.get('Authorization') || headers.get('authorization');
    } else if (typeof headers === 'object') {
      auth = headers.Authorization || headers.authorization;
    }
    if (!auth) return;
    const m = String(auth).match(/OAuth\s+(.+)/i);
    if (m) publishToken(m[1], 'fetch-header');
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      if (init?.headers) extractAuthFromHeaders(init.headers);
      if (input instanceof Request) extractAuthFromHeaders(input.headers);
    } catch {
      /* ignore */
    }
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (/api\.music\.yandex\.net.*\/(download-info|get-file-info)/i.test(url)) {
        const clone = res.clone();
        clone
          .json()
          .then((data) => {
            window.postMessage({ source: SOURCE, type: 'API_CAPTURE', url, data }, '*');
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._ymUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name)) {
      const m = String(value).match(/OAuth\s+(.+)/i);
      if (m) publishToken(m[1], 'xhr-header');
    }
    return origSetHeader.apply(this, arguments);
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'ym-ext-content') return;
    if (e.data.type === 'REQUEST_TOKEN') {
      scanHash();
      scanGlobals();
      if (cachedToken) {
        window.postMessage({ source: SOURCE, type: 'TOKEN_FOUND', token: cachedToken, origin: 'cache' }, '*');
      } else {
        window.postMessage({ source: SOURCE, type: 'TOKEN_NOT_FOUND' }, '*');
      }
    }
  });

  scanHash();
  window.addEventListener('hashchange', scanHash);
  setInterval(scanGlobals, 5000);
  console.log('[YM-EXT Bridge] page bridge active');
})();
