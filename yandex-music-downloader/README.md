# YM Playlist Downloader

Расширение Chrome (Manifest V3) для **личного** скачивания треков с [Яндекс.Музыки](https://music.yandex.ru).

> ⚠️ Не для Chrome Web Store. Нужен **Яндекс.Плюс**. На ваш риск.

## Кнопки

| Кнопка | Режим |
|--------|--------|
| **⬇ Скачать** | Быстро: MP3 по прямому URL |
| **🖼 С обложкой** | ID3 (title, artist, album) + APIC; превью в VLC и в проводнике Ubuntu |

## Установка

1. `chrome://extensions/` → Режим разработчика → Загрузить распакованное → эта папка
2. В `lib/`: `ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg.min.js`, `814.ffmpeg.js`, `browser-id3-writer.mjs`
3. OAuth-токен в popup ([инструкция](https://ym.marshal.dev/token/))

## Как работает

1. `content.js` — кнопки, обложка из `img` в строке (`PlayButtonWithCover_coverImage`, `.d-track__cover`, …)
2. `background.js` — API, быстрый или полный путь скачивания
3. `converter.mjs` — M4A→MP3 (ffmpeg); теги и APIC (`browser-id3-writer`, ID3v2.3)
4. `chrome.downloads` — файл в `YandexMusic/…`

## Сборка lib/

```bash
npm install @ffmpeg/ffmpeg@0.12.10 @ffmpeg/core@0.12.6 browser-id3-writer@6.3.1
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js lib/
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm lib/
cp node_modules/@ffmpeg/ffmpeg/dist/umd/ffmpeg.js lib/ffmpeg.min.js
cp node_modules/@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js lib/
cp node_modules/browser-id3-writer/dist/browser-id3-writer.mjs lib/
```

## Логи

Префикс `[YM-EXT]`: клик, скачивание, обложка, конвертация, готово, ошибки.

## Чеклист

- [ ] Кнопки **Скачать** и **С обложкой** у треков
- [ ] Быстрое скачивание MP3
- [ ] Обложка в Nautilus / VLC (кнопка **С обложкой**)
- [ ] OAuth-токен сохранён

## Ограничения

DRM/HLS, массовое скачивание, смена вёрстки Яндекса — см. корневой [README](../README.md).
