# TapTranslate

TapTranslate is an iOS Safari extension for translating English words and phrases directly on web pages.

The user taps a word, and the extension shows its translation and explanation based on the surrounding context.

## Components

- `extension` — Safari Web Extension: detects tapped text, extracts context, and displays translation UI.
- `ios` — iOS container application used to install, configure, and distribute the Safari extension.
- `backend` — Go service that handles translation requests and communicates with translation or AI providers.