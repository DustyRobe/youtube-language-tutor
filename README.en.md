# Video Language Tutor

[简体中文](README.md) | [English](README.en.md)

A Chrome Manifest V3 extension for learning English with YouTube videos. It provides synchronized subtitles, sentence-by-sentence pausing, and AI explanations tailored to your English level. It also supports English CC subtitles on Bilibili and manual SRT/VTT imports.

## Features

- Automatically capture subtitles and combine fragmented captions into learning segments while limiting overly long segments.
- Use a floating panel with adjustable width, subtitle navigation, playback speed controls, and sentence-by-sentence pausing. Only the current segment's explanation is expanded.
- Generate dialogue explanations, vocabulary, phrases, grammar, cultural context, and usage notes for English levels A1–C2.
- Automatically preload explanations in batches of five segments and reuse local caches.
- Edit teaching prompts for each proficiency level and interface language on a dedicated settings page.
- Set explanation and interface languages independently. Supported languages: Chinese, English, French, Japanese, Korean, Russian, Spanish, German, Portuguese, and Arabic.
- Configure provider presets for OpenAI, DeepSeek, Gemini, Claude, Qwen, Kimi, GLM, Doubao, Mistral, Groq, xAI, OpenRouter, and SiliconFlow, plus Codex and custom endpoints.
- Use Chat Completions, Responses, Anthropic Messages, or Gemini generateContent request formats.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder containing `manifest.json`.
4. Open a YouTube video and enable English captions if needed.
5. Click the ⚙ icon at the top of the panel to configure your provider, API key, an available model ID, and language preferences.

The prefilled OpenAI / Codex model name is editable. Use a model ID supported by your provider and account. Endpoint URLs, model access, regional availability, and JSON mode support vary by provider; adjust settings accordingly.

## Data and API Usage

API settings are stored locally in the browser's extension storage. Subtitles and explanations are cached locally in IndexedDB. When generating explanations, the relevant dialogue, a small amount of context, and teaching prompts are sent to the model provider you configure. Automatic preloading also consumes that provider's API usage.

The source code does not require real API keys. Do not commit keys or exported personal settings to the repository.

Automatic subtitle capture on Bilibili requires an English subtitle track in the player and may require signing in. Subtitles burned into the video image cannot be retrieved through subtitle file endpoints. Segmentation uses existing subtitle timestamps and text rules, so captions with missing punctuation or inaccurate timestamps may not split perfectly.

## Verification

Node.js is required. Logic tests do not require npm dependencies:

```sh
node --test tests/*.test.cjs
```

The layout preview test requires macOS and Google Chrome installed in its default location:

```sh
node tests/layout-browser.cjs
```

Automated API tests use mocked responses. They do not indicate that every provider has been verified with a real API key.

## Project Structure

- `src/content`: video integration, subtitle bridges, and the floating explanation panel.
- `src/background`: model requests, message routing, and caching.
- `src/settings`: the dedicated settings page.
- `src/popup`: the extension popup, model configuration, and subtitle import.
- `src/utils`: subtitle parsing, segmentation, and localization.
- `assets`: extension icons.
- `tests`: regression tests and the browser layout preview.
