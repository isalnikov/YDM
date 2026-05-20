---

### Промпт для ИИ‑агента

```text
Ты — senior full‑stack инженер, специализирующийся на браузерных расширениях Chrome Manifest V3 и реверс‑инжиниринге клиентских API. Твоя задача — написать локальное (не публикуемое в Chrome Web Store) расширение для Google Chrome, которое:

1. Встраивает на страницу плейлиста/альбома/поиска Яндекс.Музыки (music.yandex.ru) кнопки "Скачать" рядом с каждым треком.
2. По клику на кнопку начинается скачивание этого трека в виде аудиофайла (в идеале MP3).
3. ВСЯ работа и логика реализуются ТОЛЬКО внутри расширения — никаких внешних серверов, никаких локальных прокси на Python, никаких отдельных приложений. Расширение может использовать WebAssembly и Service Worker.

Ниже детальные требования и ограничения.

=== 1. ТЕХНИЧЕСКИЙ СТЕК И АРХИТЕКТУРА ===
- Манифест: Manifest V3.
- Разрешения в manifest.json: "storage", "downloads", "scripting", "offscreen" (или альтернативный механизм для работы с AudioContext/OffscreenCanvas, если потребуется).
- Host permissions: "https://music.yandex.ru/*" и все домены, с которых Яндекс отдаёт аудиопотоки (их нужно выяснить при анализе трафика).
- В расширении должен быть:
  - Service Worker (background.js) — основной управляющий центр.
  - Content Script (content.js) — внедрение кнопок и перехват действий пользователя.
  - Offscreen Document или отдельная страница (например, converter.html) — для выполнения AudioContext.decodeAudioData / ffmpeg.wasm, которые не работают в Service Worker.
- ВСЕ сетевые запросы должны идти через Service Worker (content.js не делает fetch к внешним ресурсам — только отправляет сообщения в SW).
- Для конвертации аудио используй ffmpeg.wasm (версия @ffmpeg/ffmpeg). Файлы ядра ffmpeg‑core.js и ffmpeg‑core.wasm должны быть включены в пакет расширения и загружаться локально. Загрузка из CDN запрещена политикой CSP Manifest V3 (script‑src: 'self').

=== 2. ГЛАВНЫЕ ОГРАНИЧЕНИЯ И СПОСОБЫ ИХ ОБХОДА ===
- Manifest V3 запрещает удалённый код и eval. Все скрипты должны быть локальными, никаких eval(), new Function() и т.д.
- Service Worker не имеет доступа к DOM, не может использовать AudioContext и не может передать файл в ffmpeg.wasm напрямую. Поэтому поток данных такой:
  1) Content Script находит ID трека → отправляет сообщение в SW.
  2) SW получает прямую ссылку на аудиофайл (через неофициальное API Яндекса), скачивает Blob.
  3) SW передаёт Blob в Offscreen Document (через MessagePort или chrome.runtime.sendMessage).
  4) Offscreen Document с помощью ffmpeg.wasm конвертирует Blob в MP3.
  5) Offscreen Document передаёт готовый Blob обратно в SW.
  6) SW создаёт Object URL и вызывает chrome.downloads.download({url: blobUrl, filename: ...}).
- Из‑за политики CSP в Manifest V3 для загрузки ffmpeg.wasm необходимо добавить в manifest.json:
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
  Это единственный легальный способ включить WebAssembly в MV3.
- CORS: Яндекс.Музыка, скорее всего, будет блокировать кросс‑доменные запросы. Запросы к API Яндекса должны отправляться из Service Worker — там CORS не применяется, но нужно использовать режим mode: 'cors' и, возможно, передавать куки/заголовки авторизации (credentials: 'include').

=== 3. ОПРЕДЕЛЕНИЕ ТРЕКОВ И ВНЕДРЕНИЕ КНОПОК ===
- Content Script должен запускаться на страницах "https://music.yandex.ru/*" (указать "run_at": "document_end").
- При загрузке страницы (и при динамических изменениях DOM, например, при переходе между плейлистами) content.js должен:
  - Находить все элементы треков. Селектор(ы) могут быть сложными, так как Яндекс часто меняет вёрстку. На момент написания можно использовать:
    - Элементы с data‑атрибутами: `[data-id]` или `[data-track-id]`.
    - Если data‑атрибутов нет, искать ссылки вида `a[href*="/track/"]`.
  - Извлекать ID трека (например, из href или из data‑атрибута).
  - Создавать кнопку "Скачать" (элемент <button>) и вставлять её в DOM рядом с каждым треком (например, в контейнер с кнопками лайка/поделиться).
  - Вешать на кнопку обработчик click, который вызывает chrome.runtime.sendMessage({action: "download", trackId: "12345", title: "Название трека"}).
- Так как контент на Яндекс.Музыке грузится динамически (React SPA), используй MutationObserver для отслеживания появления новых треков.

=== 4. ПОЛУЧЕНИЕ ПРЯМОЙ ССЫЛКИ НА АУДИОФАЙЛ (КЛИЕНТСКАЯ ЧАСТЬ) ===
- Яндекс.Музыка использует неофициальное REST API по адресу https://api.music.yandex.net/.
- Для получения прямой ссылки на трек нужен accessToken пользователя. Его можно извлечь:
  - Из localStorage веб‑страницы music.yandex.ru (ключ обычно "accessToken" или подобный).
  - Content Script имеет доступ к localStorage страницы и может передать токен в SW.
- Алгоритм в Service Worker:
  1) Получить информацию о треке: GET https://api.music.yandex.net/tracks/{trackId} (заголовок Authorization: OAuth {token}).
  2) Получить download info: GET https://api.music.yandex.net/tracks/{trackId}/download-info (также с токеном).
  3) Из ответа взять ссылку на XML с информацией о загрузке (поле downloadInfoUrl) и запросить её (обычно это GET без токена). В ответе будет XML с прямыми ссылками на аудиофайлы разных битрейтов.
  4) Выбрать наилучший битрейт (обычно 320 kbps или 192 kbps).
  5) Скачать аудиофайл как Blob (fetch(url)).
- Важно: без авторизации API отдаст только 30‑секундные превью. Полноценные треки доступны только при наличии действующего токена.
- Формат исходного файла: чаще всего это M4A/AAC или TS‑сегменты. Для одиночных треков обычно отдаётся цельный файл M4A.

=== 5. КОНВЕРТАЦИЯ В MP3 НА СТОРОНЕ КЛИЕНТА ===
- Конвертация выполняется в Offscreen Document.
- Используй ffmpeg.wasm (пакет @ffmpeg/ffmpeg). Убедись, что core файлы загружаются локально из папки расширения.
- Алгоритм конвертации:
  1) Получить Blob (Uint8Array) из SW.
  2) Записать Blob в виртуальную файловую систему ffmpeg.wasm (ffmpeg.writeFile('input.m4a', data)).
  3) Выполнить команду: ffmpeg -i input.m4a -codec:a libmp3lame -q:a 2 output.mp3 (или другие параметры качества).
  4) Прочитать результат: ffmpeg.readFile('output.mp3') → получить Uint8Array.
  5) Создать Blob и отправить его обратно в SW.
- Обрати внимание: ffmpeg.wasm тяжеловесный (ядро ~31 MB). Чтобы не замедлять запуск расширения, инициализируй ffmpeg лениво при первом запросе на конвертацию. Можно также использовать SAB (SharedArrayBuffer), но это требует определённых заголовков, которые не всегда доступны в расширении. Используй однопоточную версию ffmpeg.wasm для совместимости.
- Предусмотри fallback: если конвертация не удалась, попробуй сохранить файл в исходном формате (M4A).

=== 6. ЗАГРУЗКА ФАЙЛА ===
- После конвертации SW должен:
  1) Создать Blob URL (URL.createObjectURL(blob)).
  2) Вызвать chrome.downloads.download({
       url: blobUrl,
       filename: "YandexMusic/Исполнитель - Название.mp3",
       saveAs: false
     }).
  3) После завершения загрузки (или через некоторое время) освободить Blob URL через URL.revokeObjectURL.
- Имя файла формируй из тегов: "Исполнитель — Название.mp3". Удали недопустимые символы (< > : " / \ | ? *).

=== 7. ВЫБОР ПАПКИ ДЛЯ СОХРАНЕНИЯ ===
- Chrome API не позволяет принудительно указать папку для загрузки — всегда используется папка загрузок по умолчанию или предлагается диалог (saveAs: true).
- Чтобы дать пользователю возможность один раз выбрать папку и сохранять туда все треки, используй File System Access API (showDirectoryPicker()):
  - В интерфейсе настроек расширения (popup или options page) размести кнопку "Выбрать папку".
  - При клике вызывай showDirectoryPicker(), получай FileSystemDirectoryHandle.
  - Сохраняй handle в IndexedDB (он не сериализуется, но IndexedDB поддерживает хранение FileSystemDirectoryHandle).
  - При последующих загрузках SW может извлечь handle из IndexedDB и записать файл напрямую, минуя chrome.downloads.
- Это опциональная фича. Основной способ — chrome.downloads.download.

=== 8. СТРУКТУРА ФАЙЛОВ РАСШИРЕНИЯ ===
```
yandex-music-downloader/
├── manifest.json
├── background.js          # Service Worker
├── content.js             # Content Script
├── converter.html         # Offscreen Document для ffmpeg.wasm
├── converter.js           # Логика конвертации
├── popup.html             # Интерфейс (опционально)
├── popup.js
├── lib/
│   ├── ffmpeg-core.js     # Ядро ffmpeg.wasm
│   ├── ffmpeg-core.wasm   # WebAssembly ядро
│   └── ffmpeg.min.js      # Основной модуль ffmpeg.wasm
└── icons/                 # Иконки расширения
```

=== 9. ЮРИДИЧЕСКИЕ И ЭТИЧЕСКИЕ ОГРАНИЧЕНИЯ (ЧТО НЕЛЬЗЯ ДЕЛАТЬ) ===
- Расширение предназначено ТОЛЬКО для личного использования, не для распространения через Chrome Web Store.
- НЕ обходить авторизацию Яндекса — для скачивания полных треков требуется действующий аккаунт с подпиской Яндекс.Плюс.
- НЕ скачивать треки автоматически (массово) — только по одному, явным действием пользователя.
- НЕ удалять и не подменять рекламу на странице.
- НЕ распространять скачанные файлы.
- НЕ использовать eval() и удалённые скрипты (строгое требование MV3).
- В интерфейсе расширения (popup) должно быть явное предупреждение пользователю: "Вы должны иметь активную подписку Яндекс.Плюс. Скачивание регулируется условиями использования сервиса Яндекс.Музыка."

=== 10. ОТЛАДКА, ТЕСТИРОВАНИЕ И ЛОГИРОВАНИЕ ===
- Логирование:
  - В Service Worker используй console.log/error (видно на странице chrome://extensions/ → "Service Worker").
  - В Content Script логи выводятся в DevTools страницы Яндекс.Музыки.
  - В Offscreen Document логи видны в консоли этой страницы (открыть через chrome://extensions/ → "offscreen.html").
  - Для production режима добавь флаг DEBUG в коде и оберни console.log в условия.
- Тестирование:
  1) Загрузи расширение как распакованное в chrome://extensions/.
  2) Проверь, что кнопки появляются на странице плейлиста, альбома и поиска.
  3) Проверь полный цикл скачивания одного трека.
  4) Проверь ситуацию, когда нет интернета.
  5) Проверь ситуацию, когда токен истёк — расширение должно показать ошибку и предложить перезайти на Яндекс.Музыку.
  6) Проверь конвертацию для разных битрейтов.
  7) Проверь, что при отсутствии ffmpeg.wasm (ошибка загрузки ядра) сохраняется исходный файл.

=== 11. ДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ ===
- Кнопка "Скачать" должна быть стилизована под дизайн Яндекс.Музыки (тёмная тема/светлая тема — зависит от темы пользователя). Можно использовать готовые CSS‑классы Яндекса.
- Во время скачивания кнопка должна менять состояние (показывать спиннер или надпись "Загрузка...").
- Если трек уже скачан ранее, можно показать другой значок (опционально, используй chrome.storage.local для хранения списка скачанных ID).
- Обработка ошибок: все fetch должны быть обёрнуты в try/catch, ошибки должны показываться пользователю через уведомления (chrome.notifications или alert в content script).

Напиши, пожалуйста, полный код расширения в виде готового проекта (все файлы), с подробными комментариями на русском языке. Код должен быть готов к загрузке как распакованное расширение и работать в актуальной версии Google Chrome.
```

# 🤖 ПРОМПТ ДЛЯ ИИ-АГЕНТА: Chrome Extension "Yandex Music Playlist Downloader"

> **Цель:** Сгенерировать полный, рабочий код расширения Chrome (Manifest V3), которое инжектирует кнопку `⬇ Скачать` рядом с каждым треком на странице плейлиста Яндекс.Музыки. При клике файл должен сохраняться в Downloads. Вся логика, обработка данных и скачивание реализуются **внутри расширения**.

---

## 🎯 ROLE & OBJECTIVE
Ты — Senior Chrome Extension Developer (MV3) с экспертизой в:
- Content Scripts & SPA DOM Manipulation
- `chrome.downloads`, `chrome.storage`, `chrome.runtime` messaging
- Network interception / Page context data extraction
- Debugging, logging, and LLM-friendly code architecture

Твоя задача: выдать **готовое к установке расширение** с четкой структурой, комментариями, обработкой ошибок и документацией по тестированию.

---

## 📦 ARCHITECTURE & STACK
| Component          | File(s)                  | Responsibility                                                                 |
|--------------------|--------------------------|--------------------------------------------------------------------------------|
| `manifest.json`    | `manifest.json`          | MV3 config, permissions, host matches, service worker                          |
| Content Script     | `content.js`             | DOM observation, button injection, track metadata extraction, UI rendering     |
| Service Worker     | `background.js`          | Download dispatch, error handling, URL resolution, messaging hub               |
| Utilities          | `utils.js`               | Logging, debounce, selectors, safe DOM helpers, retry logic                    |
| Optional UI        | `popup.html`, `popup.js` | Status panel, toggle, download history, settings                               |
| Docs               | `README.md`              | Install steps, debugging guide, limitations, testing checklist                 |

**Code Style Requirements:**
- ES Modules / IIFE-free, top-level `async/await`
- Explicit error boundaries (`try/catch` + fallback)
- Predictable function signatures, JSDoc types
- Zero external dependencies (pure vanilla JS)
- LLM-optimized: small, single-responsibility functions, no nested callbacks > 2 levels

---

## 📜 MANIFEST V3 CONFIG
```json
{
  "manifest_version": 3,
  "name": "YM Playlist Downloader",
  "version": "1.0.0",
  "description": "Adds download buttons to Yandex Music playlist tracks",
  "permissions": ["downloads", "storage", "activeTab"],
  "host_permissions": ["*://music.yandex.ru/*", "*://music.yandex.by/*", "*://music.yandex.kz/*", "*://music.yandex.uz/*"],
  "content_scripts": [{
    "matches": ["*://music.yandex.ru/*", "*://music.yandex.by/*", "*://music.yandex.kz/*", "*://music.yandex.uz/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  }
}
```
> ⚠️ Не используй `webRequest` blocking. MV3 требует event-driven `chrome.downloads`.

---

## 🔍 DATA EXTRACTION & TRACK URL RESOLUTION
Яндекс.Музыка — React SPA. Данные треков **не статичны в DOM**. Реализуй многоуровневый fallback:

1. **Primary:** Чтение из `window.__INITIAL_STATE__` (или аналогичного глобального объекта) через `unsafeWindow` или `window.postMessage` bridge. Ищи массив треков в `playlist.tracks` или `page.playlists[0].tracks`.
2. **Secondary:** Intercept `fetch`/`XMLHttpRequest` via injected page script, filter by regex `/api/v2\/track\/\d+\/download-info/` или `/get-track-info/`. Кешируй подписанные URL в `chrome.storage.local`.
3. **Fallback:** Парсинг `data-track-id`, `data-url` или `meta[property="og:audio"]` из текущего трека при наведении/клике.

**Важно:**
- URL'ы Яндекс.Музыки **временные** (expire ~1-2 часа). Извлекай их **в момент клика**, не кешируй надолго.
- Если поток HLS/DASH — скачивай `.mp3`/`.aac` прямой линк из `download-info` endpoint. Не пытайся собирать сегменты внутри MV3 (ограничения CORS/Quota).

---

## 🖱️ DOM INJECTION & BUTTON PLACEMENT
- Используй `MutationObserver` для отслеживания появления `.d-playlist .track` или аналогичных контейнеров.
- Кнопка инжектируется **в shadow DOM или рядом с `.track__title`** через `Element.insertAdjacentHTML('beforeend', ...)`.
- Стили: `position: absolute; right: 8px; top: 50%; transform: translateY(-50%);` + `z-index: 10`. Не ломай верстку.
- Добавь `data-track-id`, `data-status` для отслеживания состояния (idle/downloading/done/error).
- Обработчик клика: `e.stopPropagation()`, `e.preventDefault()`, отправляет `chrome.runtime.sendMessage({type: 'DOWNLOAD_TRACK', id, url})`.

**SPA Handling:**
- Debounce observer (300ms)
- Cleanup listeners на `window` unload
- Re-inject на `popstate`, `hashchange`, или при изменении `window.location.pathname`

---

## ⬇️ DOWNLOAD FLOW & FOLDER HANDLING
```js
chrome.downloads.download({
  url: trackUrl,
  filename: `${trackTitle} - ${trackArtist}.mp3`,
  conflictAction: 'uniquify',
  saveAs: false // см. ограничения ниже
})
```
**Выбор папки:**
- Chrome **не позволяет** программно выбирать папку на каждый файл из-за sandbox.
- Единственный способ: пользователь меняет папку загрузок в `chrome://settings/downloads` или включает `Ask where to save each file` в настройках.
- В `popup` добавь toggle `chrome.downloads.setShelfEnabled` (если применимо) или инструкцию.
- **Не используй** `chrome.fileSystem` без явного user gesture.

**Error Handling:**
- `chrome.downloads.onChanged` → track status
- Retry 1x на `NETWORK_FAILED`
- Fallback: `window.open(url, '_blank')` если `chrome.downloads` недоступен

---

## 🛡️ SECURITY, PERMISSIONS & LIMITATIONS
| Ограничение                          | Решение / Обход                                                                 |
|--------------------------------------|---------------------------------------------------------------------------------|
| MV3 Service Worker sleeps            | Храни состояние в `chrome.storage.local`, используй `chrome.alarms` если нужно  |
| CORS для сторонних доменов           | Скачивай только с `music.yandex.*` или используй `chrome.downloads` (обходит CORS) |
| Временные URL                        | Запрашивай свежий URL при каждом клике                                          |
| Anti-bot / Rate Limit                | Добавь debounce (500ms) между кликами, не скачивай >5 треков одновременно       |
| TOS Яндекс.Музыки                    | ⚠️ Укажи в README: "Только для личного использования. Нарушение TOS на ваш риск." |
| DRM / Encrypted Streams              | Если поток защищен (AES-128, Widevine) — расширение не должно ломать шифрование |

---

## 🐛 DEBUGGING, LOGGING & TESTING
**Логирование:**
```js
// utils.js
const LOG = (level, ...args) => console[level](`[YM-EXT]`, ...args);
```
- Включай/выключай через `chrome.storage.local.get('debug')`
- Логируй: DOM injection count, URL fetch latency, download status, errors

**Тестирование (чеклист для AI):**
1. ✅ Extension loads without console errors
2. ✅ Buttons appear on playlist load & pagination
3. ✅ Click → background receives message → download starts
4. ✅ Filename matches `Title - Artist.ext`
5. ✅ Handles network failure, expired URL, duplicate track
6. ✅ No memory leaks (observer disconnected, listeners removed)
7. ✅ Works on `music.yandex.ru`, `.by`, `.kz`

**Debug Tools:**
- `chrome://extensions` → "Inspect views: Service Worker"
- DevTools → Elements → Search injected buttons
- Network tab → Filter `download-info`
- Console → `[YM-EXT]` logs

---

## 📤 DELIVERABLES & OUTPUT FORMAT
Выдай **полный код** в следующем порядке (каждый файл в отдельном блоке):
1. `manifest.json`
2. `content.js`
3. `background.js`
4. `utils.js`
5. `popup.html` + `popup.js`
6. `README.md` (установка, отладка, ограничения, TOS disclaimer)

**Требования к коду:**
- JSDoc для всех функций
- Четкие границы `try/catch`
- Без глобальных переменных (используй IIFE или модули)
- Комментарии `// LLM-NOTE:` где логика может потребовать доработки ИИ
- Формат: чистый Markdown, без лишних пояснений

---

## ⚠️ LEGAL & TECHNICAL DISCLAIMERS
- Данное расширение **не обходит DRM**. Если Яндекс вернет зашифрованный поток или HLS сегменты, скачивание полного трека потребует отдельного демуксера (вне scope MV3).
- Временные URL expire быстро. Расширение должно запрашивать их **синхронно при клике**.
- Нарушение Terms of Service Яндекс.Музыки возможно. Используй только для личного архивирования треков, к которым у тебя есть права.
- Chrome Web Store **не примет** такое расширение. Распространяй только как `load unpacked`.

---

## 💡 LLM OPTIMIZATION GUIDELINES
1. **Детерминизм:** Не используй `Math.random()`, `setTimeout` без цели, неявные `any`.
2. **Переписываемость:** Каждая функция ≤ 30 строк, один вход, один выход, явные зависимости.
3. **Отладка:** Добавь `chrome.runtime.onMessage` echo для тестов. Логируй payload до/after обработки.
4. **Fallback-first:** Если `chrome.downloads` недоступен → `window.open()`. Если `MutationObserver` падает → `setInterval` 2s.
5. **Self-Healing:** Если кнопка не появилась за 3s → retry injection. Если URL expired → notify user.

---
✅ **Готов к генерации. Выдай полный код расширения строго по структуре выше.**