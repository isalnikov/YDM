/**
 * Content Script: кнопки «Скачать» на Яндекс.Музыке.
 */
(function () {
  'use strict';

  const U = globalThis.YMUtils;
  const BUTTON_CLASS = 'ym-ext-download-btn';
  const ROW_ATTR = 'data-ym-ext-row';
  const MAX_CONCURRENT = 1;
  let activeDownloads = 0;
  let scanCount = 0;

  /** @param {'log'|'warn'|'error'|'info'} level @param {string} action @param {...unknown} d */
  function log(level, action, ...d) {
    if (U?.LOG) U.LOG(level, action, ...d);
    else console[level]('[YM-EXT]', action, ...d);
  }

  function injectStyles() {
    if (document.getElementById('ym-ext-styles')) return;
    const style = document.createElement('style');
    style.id = 'ym-ext-styles';
    style.textContent = `
      .d-track, [class*="Track"]:has(.${BUTTON_CLASS}) { position: relative !important; }
      .${BUTTON_CLASS} {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        align-items: center;
        justify-content: center;
        margin-left: 6px;
        padding: 5px 12px;
        min-width: 88px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        line-height: 1.2;
        border: none;
        border-radius: 100px;
        cursor: pointer;
        z-index: 9999 !important;
        pointer-events: auto !important;
        background: #ffcc00 !important;
        color: #000 !important;
        box-shadow: 0 1px 4px rgba(0,0,0,.25);
        flex-shrink: 0;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover:not(:disabled) { filter: brightness(1.05); }
      .${BUTTON_CLASS}:disabled { opacity: 0.7; cursor: wait; }
      .${BUTTON_CLASS}[data-status="done"] { background: #4ade80 !important; color: #052e16 !important; }
      .${BUTTON_CLASS}[data-status="error"] { background: #f87171 !important; color: #450a0a !important; }
      .d-track__actions .${BUTTON_CLASS}, .d-track__col .${BUTTON_CLASS} { margin-right: 4px; }
    `;
    (document.head || document.documentElement).appendChild(style);
    log('log', 'стили кнопок добавлены');
  }

  /**
   * ID трека из элемента .d-track (как в yandex-music-downloader).
   * @param {Element} trackEl
   * @returns {string|null}
   */
  function getTrackIdFromDTrack(trackEl) {
    const a =
      trackEl.querySelector('.d-track__name a') ||
      trackEl.querySelector('a[href*="/track/"]') ||
      trackEl.querySelector('[href*="/track/"]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    return U?.trackIdFromHref(href) || href.match(/\/track\/(\d+)/)?.[1] || null;
  }

  /**
   * @param {Element} trackEl
   */
  function extractMetaFromDTrack(trackEl) {
    const trackId = getTrackIdFromDTrack(trackEl);
    if (!trackId) return null;

    const titleEl =
      trackEl.querySelector('.d-track__name') ||
      trackEl.querySelector('[class*="title"]');
    const artistEl =
      trackEl.querySelector('.d-track__artists') ||
      trackEl.querySelector('[class*="artist"]');

    const title = (titleEl?.textContent || 'Без названия').trim().split('\n')[0];
    const artist = (artistEl?.textContent || 'Неизвестный исполнитель').trim().split('\n')[0];

    return { trackId: String(trackId), title, artist };
  }

  /**
   * @param {Element} row
   */
  function extractMetaGeneric(row) {
    let trackId =
      row.getAttribute('data-track-id') ||
      row.querySelector('[data-track-id]')?.getAttribute('data-track-id');

    const link = row.querySelector('a[href*="/track/"]');
    if (!trackId && link) {
      trackId = U?.trackIdFromHref(link.href) || link.href.match(/\/track\/(\d+)/)?.[1];
    }
    if (!trackId) return null;

    const title =
      row.querySelector('[class*="title"]')?.textContent ||
      link?.textContent ||
      'Без названия';
    const artist =
      row.querySelector('[class*="artist"]')?.textContent || 'Неизвестный исполнитель';

    return {
      trackId: String(trackId),
      title: title.trim().split('\n')[0],
      artist: artist.trim().split('\n')[0]
    };
  }

  /**
   * @param {Element} el
   * @returns {{ trackId: string, title: string, artist: string }|null}
   */
  function extractMeta(el) {
    if (el.classList?.contains('d-track')) return extractMetaFromDTrack(el);
    const dTrack = el.closest?.('.d-track');
    if (dTrack) return extractMetaFromDTrack(dTrack);
    const row = el.closest?.('[data-track-id]') || el.closest?.('div[class*="track" i]') || el;
    return extractMetaGeneric(row);
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {string} status
   * @param {string} label
   */
  function setButtonState(btn, status, label) {
    btn.dataset.status = status;
    btn.textContent = label;
    btn.disabled = status === 'downloading';
  }

  /**
   * @param {{ trackId: string, title: string, artist: string }} meta
   * @param {HTMLButtonElement} btn
   */
  async function handleDownloadClick(btn, meta) {
    if (btn.dataset.status === 'downloading' || activeDownloads >= MAX_CONCURRENT) return;

    log('log', 'клик «Скачать»', meta.trackId, meta.title);

    const token = await U.getAccessToken();
    log('log', 'токен для запроса', token ? token.slice(0, 12) + '…' : '(НЕТ — нужен OAuth в popup)');
    if (!token) {
      setButtonState(btn, 'error', 'Нет токена');
      alert(
        'OAuth-токен не найден.\n\n1. Откройте popup расширения\n2. Нажмите «Получить токен (OAuth)»\n3. Войдите в Яндекс\n4. Скопируйте access_token из адресной строки\n5. Вставьте в popup → «Сохранить токен»'
      );
      return;
    }

    activeDownloads++;
    setButtonState(btn, 'downloading', 'Загрузка...');

    try {
      const host = window.location.hostname;
      const response = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_TRACK',
        trackId: meta.trackId,
        title: meta.title,
        artist: meta.artist,
        token: token || null,
        musicHost: host
      });

      if (response?.ok) {
        setButtonState(btn, 'done', '✓ Готово');
        log('log', 'трек скачан', meta.trackId, response.filename);
        const { downloadedTracks = [] } = await chrome.storage.local.get('downloadedTracks');
        if (!downloadedTracks.includes(meta.trackId)) {
          downloadedTracks.push(meta.trackId);
          await chrome.storage.local.set({ downloadedTracks: downloadedTracks.slice(-500) });
        }
      } else {
        setButtonState(btn, 'error', 'Ошибка');
        log('error', 'скачивание не удалось', meta.trackId, response?.error);
        alert(response?.error || 'Не удалось скачать трек');
      }
    } catch (err) {
      setButtonState(btn, 'error', 'Ошибка');
      log('error', 'sendMessage', err);
      alert('Ошибка расширения. Перезагрузите его на chrome://extensions');
    } finally {
      activeDownloads--;
    }
  }

  /**
   * @param {Element} container
   * @param {{ trackId: string, title: string, artist: string }} meta
   */
  function mountButton(container, meta) {
    const existing = container.querySelector(`.${BUTTON_CLASS}[data-track-id="${meta.trackId}"]`);
    if (existing) return false;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = '⬇ Скачать';
    btn.dataset.trackId = meta.trackId;
    btn.dataset.status = 'idle';
    btn.title = `${meta.artist} — ${meta.title}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn, meta);
    });

    const actions =
      container.querySelector('.d-track__actions') ||
      container.querySelector('.d-track__col_dur') ||
      container.querySelector('.d-track__col');

    if (actions) {
      actions.prepend(btn);
    } else {
      container.appendChild(btn);
    }

    log('log', 'добавлена кнопка', meta.trackId, meta.title);
    return true;
  }

  /**
   * @param {Element} trackEl — .d-track
   */
  function processDTrack(trackEl) {
    if (trackEl.getAttribute(ROW_ATTR) === '1') {
      const meta = extractMetaFromDTrack(trackEl);
      if (meta && !trackEl.querySelector(`.${BUTTON_CLASS}[data-track-id="${meta.trackId}"]`)) {
        trackEl.removeAttribute(ROW_ATTR);
      } else {
        return;
      }
    }

    const meta = extractMetaFromDTrack(trackEl);
    if (!meta) {
      log('warn', 'трек без ID в .d-track', trackEl);
      return;
    }

    log('log', 'найден трек (.d-track)', meta.trackId, meta.title);
    if (mountButton(trackEl, meta)) {
      trackEl.setAttribute(ROW_ATTR, '1');
    }
  }

  /**
   * Fallback: ссылки /track/
   */
  function processTrackLinks() {
    document.querySelectorAll('a[href*="/track/"]').forEach((link) => {
      const row =
        link.closest('.d-track') ||
        link.closest('[class*="Track"]') ||
        link.closest('div[class*="track" i]') ||
        link.parentElement;
      if (!row || row.classList?.contains('d-track')) return;

      const meta = extractMeta(row);
      if (!meta) return;
      if (row.querySelector(`.${BUTTON_CLASS}[data-track-id="${meta.trackId}"]`)) return;

      log('log', 'найден трек (ссылка)', meta.trackId);
      mountButton(row, meta);
    });
  }

  /**
   * Новый интерфейс Яндекс.Музыки (React) — строки без .d-track.
   */
  function processModernRows() {
    const rows = document.querySelectorAll(
      [
        '[class*="TrackPlaylist"][class*="track"]',
        '[class*="TrackRow"]',
        '[class*="track_row"]',
        '[class*="Track_root"]',
        'div[class*="Track"]:has(a[href*="/track/"])'
      ].join(', ')
    );
    rows.forEach((row) => {
      if (row.classList.contains('d-track')) return;
      const meta = extractMeta(row);
      if (!meta) return;
      if (row.querySelector(`.${BUTTON_CLASS}[data-track-id="${meta.trackId}"]`)) return;
      log('log', 'найден трек (modern UI)', meta.trackId);
      mountButton(row, meta);
    });
  }

  function scanAndInject() {
    scanCount++;
    const dTracks = document.querySelectorAll('.d-track');
    const links = document.querySelectorAll('a[href*="/track/"]');

    log('log', `сканирование #${scanCount}`, {
      dTrack: dTracks.length,
      links: links.length,
      url: location.pathname
    });

    dTracks.forEach(processDTrack);
    processModernRows();
    processTrackLinks();
    markDownloadedTracks();
  }

  async function markDownloadedTracks() {
    const { downloadedTracks = [] } = await chrome.storage.local.get('downloadedTracks');
    const set = new Set(downloadedTracks);
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => {
      if (set.has(btn.dataset.trackId)) {
        setButtonState(/** @type {HTMLButtonElement} */ (btn), 'done', '✓ Скачан');
      }
    });
  }

  /** Автосохранение токена из #access_token= в URL */
  function captureTokenFromHash() {
    const hash = location.hash || '';
    const m = hash.match(/access_token=([^&]+)/);
    if (!m) return false;
    const token = decodeURIComponent(m[1]);
    if (!U?.looksLikeYandexToken?.(token)) {
      log('warn', 'hash access_token не похож на OAuth', token.slice(0, 20));
      return false;
    }
    U.setCachedToken(token);
    chrome.storage.local.set({ oauthToken: token });
    chrome.runtime.sendMessage({ type: 'SAVE_TOKEN', token }).catch(() => {});
    log('info', 'токен из URL (#access_token) сохранён', token.slice(0, 14) + '…');
    return true;
  }

  function init() {
    log('info', 'content script старт', location.href);
    injectStyles();
    U?.initBridgeListener?.();
    captureTokenFromHash();
    window.addEventListener('hashchange', captureTokenFromHash);

    scanAndInject();

    const debounced = U?.debounce ? U.debounce(scanAndInject, 200) : scanAndInject;

    const observer = new MutationObserver((mutations) => {
      const added = mutations.some((m) => m.addedNodes.length > 0);
      if (added) debounced();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('scroll', debounced, { passive: true });
    window.addEventListener('popstate', () => setTimeout(scanAndInject, 300));
    window.addEventListener('hashchange', () => setTimeout(scanAndInject, 300));

    setInterval(scanAndInject, 2000);

    [300, 800, 1500, 3000, 6000].forEach((ms) => setTimeout(scanAndInject, ms));

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'RESCAN_TRACKS') {
        log('log', 'принудительное пересканирование');
        document.querySelectorAll(`[${ROW_ATTR}]`).forEach((el) => el.removeAttribute(ROW_ATTR));
        scanAndInject();
      }
    });

    log('info', 'наблюдатели DOM активны');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
