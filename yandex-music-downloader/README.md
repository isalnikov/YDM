# YM Playlist Downloader

Расширение Chrome (Manifest V3) для **личного** скачивания треков с [Яндекс.Музыки](https://music.yandex.ru). Добавляет кнопку **⬇ Скачать** рядом с треками на плейлистах, альбомах и в поиске.

> ⚠️ **Не публикуйте в Chrome Web Store.** Только установка в режиме «Распакованное расширение». Нужна подписка **Яндекс.Плюс** для полных треков. Использование на ваш риск с точки зрения условий сервиса.

## Установка

1. Скачайте или клонируйте папку `yandex-music-downloader`.
2. Убедитесь, что в `lib/` есть файлы ffmpeg (~31 MB):
   - `ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg.min.js`, `814.ffmpeg.js`
3. Откройте `chrome://extensions/`.
4. Включите **Режим разработчика**.
5. **Загрузить распакованное расширение** → выберите папку `yandex-music-downloader`.
6. Войдите в аккаунт на [music.yandex.ru](https://music.yandex.ru) и откройте плейлист/альбом.

## Как работает

1. **Content script** (`content.js`) находит треки в DOM, вставляет кнопки, читает OAuth-токен из `localStorage` страницы.
2. По клику отправляет сообщение в **Service Worker** (`background.js`).
3. SW запрашивает `api.music.yandex.net` → `download-info` → XML → прямая ссылка на аудио.
4. SW скачивает аудио в память, загружает обложку с `avatars.yandex.net` по `coverUri` из API трека.
5. **Offscreen Document** (`converter.html`) через **ffmpeg.wasm** собирает MP3 с **ID3-тегами** (title, artist, album) и встроенной обложкой (**APIC** / `attached_pic`).
6. Готовый файл сохраняется через `chrome.downloads` (`YandexMusic/Исполнитель - Название.mp3`).

## Структура

```
yandex-music-downloader/
├── manifest.json
├── background.js       # Service Worker
├── content.js          # Кнопки на странице
├── utils.js            # Утилиты для content script
├── converter.html/js   # Offscreen + ffmpeg
├── popup.html/js       # Настройки и предупреждение
├── lib/                # ffmpeg.wasm (не в git — см. ниже)
└── icons/
```

## Сборка lib/ (если отсутствует)

```bash
cd yandex-music-downloader
npm install @ffmpeg/ffmpeg@0.12.10 @ffmpeg/core@0.12.6
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js lib/
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm lib/
cp node_modules/@ffmpeg/ffmpeg/dist/umd/ffmpeg.js lib/ffmpeg.min.js
cp node_modules/@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js lib/
```

## Отладка

Логи **всегда включены** (префикс `[YM-EXT]`).

| Компонент        | Где смотреть логи                                      |
|------------------|--------------------------------------------------------|
| Content + Bridge | F12 на music.yandex.ru → Console → фильтр `YM-EXT`     |
| Service Worker   | `chrome://extensions` → «Service Worker»             |
| Offscreen        | `chrome://extensions` → offscreen/converter            |

**Нет токена:** расширение скачивает через cookies сессии. Если не работает — в popup вставьте OAuth-токен ([инструкция](https://ym.marshal.dev/token/)).

### Чеклист тестирования

- [ ] Расширение загружается без ошибок
- [ ] Кнопки появляются на плейлисте и при прокрутке
- [ ] Клик → файл в Downloads
- [ ] Имя файла: `Исполнитель - Название.mp3`
- [ ] В плеере/проводнике видна обложка альбома (ID3 APIC)
- [ ] Без авторизации — сообщение о токене
- [ ] При ошибке ffmpeg — сохраняется исходный M4A/MP3

## Ограничения

- **Папка загрузок** — только через настройки Chrome или `saveAs` (программно папку не задать).
- **DRM / HLS** — зашифрованные потоки не поддерживаются.
- **Временные URL** — запрашиваются при каждом клике.
- **Токен** — при смене вёрстки/ключей localStorage может потребоваться доработка `extractAccessToken()` в `utils.js`.
- **Селекторы DOM** — Яндекс меняет вёрстку; при необходимости обновите селекторы в `content.js` (комментарии `LLM-NOTE`).

## Правовая информация

Расширение не обходит авторизацию и не скачивает треки автоматически. Предназначено для архивирования контента, на который у вас есть права по подписке. Не распространяйте скачанные файлы.
