(async function () {
  'use strict';

  const OAUTH_URL =
    'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d&redirect_uri=https%3A%2F%2Fmusic.yandex.ru%2F';

  const statsEl = document.getElementById('stats');
  const tokenEl = document.getElementById('token');
  const saveBtn = document.getElementById('saveToken');
  const getTokenBtn = document.getElementById('getToken');
  const rescanBtn = document.getElementById('rescan');

  const { oauthToken } = await chrome.storage.local.get('oauthToken');
  if (oauthToken) tokenEl.value = oauthToken;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes('access_token=')) {
    document.getElementById('hashHint').style.display = 'block';
  }

  async function refreshStats() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      statsEl.innerHTML = status?.hasToken
        ? '<span class="ok">✓ Токен сохранён</span> · скачано: ' + (status.downloadedCount ?? 0)
        : '<span class="err">✗ Токен не задан — скачивание не работает</span>';
    } catch {
      statsEl.textContent = 'Откройте music.yandex.ru';
    }
  }

  await refreshStats();

  getTokenBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: OAUTH_URL });
    alert(
      'После входа в Яндекс скопируйте access_token из адресной строки (между access_token= и &).\nВставьте в поле ниже и нажмите «Сохранить токен».'
    );
  });

  saveBtn.addEventListener('click', async () => {
    let token = tokenEl.value.trim();
    if (token.includes('access_token=')) {
      const m = token.match(/access_token=([^&]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    token = token.replace(/^OAuth\s+/i, '');
    await chrome.runtime.sendMessage({ type: 'SAVE_TOKEN', token });
    console.log('[YM-EXT Popup] токен сохранён', token ? token.slice(0, 12) + '…' : '(очищен)');
    await refreshStats();
    alert(token ? 'Токен сохранён. Обновите music.yandex.ru и попробуйте скачать.' : 'Токен очищен');
  });

  rescanBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN_TRACKS' }).catch(() => {});
    }
    window.close();
  });
})();
