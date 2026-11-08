# Translation evaluation

This directory holds the data for stage 2 of the [roadmap](../docs/roadmap.md): it checks whether an LLM gives a good contextual translation fast enough and cheap enough for a tap.

## Files

- `sources.json` — the samples to capture. Each sample is a page URL, a quote from the page, the word to tap inside the quote, the kind of page, the kind of case (`plain`, `phrasal-verb`, `idiom`, `ambiguous`, `term`, `slang`), and the expected meaning in Russian. If the word occurs more than once in the quote, `occurrence` selects one (1 by default).
- `contexts.json` — the captured samples. It is generated from `sources.json`. Each sample has the `DetectionContext` that the extension sends for the tap.
- `results/` — evaluation runs. Git ignores this directory.

## Sources and licenses

All texts come from sources that allow redistribution. Each sample keeps its URL and license.

| Source                                      | License                         |
| ------------------------------------------- | ------------------------------- |
| Project Gutenberg books                     | Public domain in the USA        |
| NASA news                                   | Public domain (U.S. Government) |
| go.dev, kubernetes.io                       | CC BY 4.0                       |
| MDN Web Docs                                | CC BY-SA 2.5                    |
| Wikipedia                                   | CC BY-SA 4.0                    |
| Wikinews                                    | CC BY 2.5                       |

Use only sources with such licenses, because the repository is public.

## Capture the samples

The capture script opens each page in Playwright WebKit and clicks the word. A click listener in the page calls the same `detectEnglishContext` as the content script. So the samples contain what the extension really extracts, including its defects.

```sh
cd extension
npx playwright install webkit   # once
npm run capture-contexts
```

The script writes `contexts.json` only when all samples are captured. If a page changed and a quote is not on it anymore, fix or replace the sample in `sources.json`.

The viewport is a desktop one (1280×900), because mobile versions of some sites hide sections of the text.

## Run the evaluation

```sh
cd backend
go run ./cmd/evaluate \
  -base-url "$LLM_BASE_URL" \
  -model qwen3.8-flash \
  -api-key-file ~/.config/alibabacloud/key \
  -context-modes sentence,block,full \
  -input-price 0.15 -output-price 0.47
```

`-base-url` is the root of an OpenAI-compatible API, for example `https://<workspace>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` for Alibaba Cloud Model Studio. The tool never prints the API key.

Variants:

- `-context-modes`: `sentence` sends only the sentence with the word, `block` sends the focus block, `full` sends the focus block and its neighbor blocks.
- `-thinking`: `off` and `on` send `enable_thinking`, an extension of Model Studio for Qwen3.x models. `default` does not send the field; use it for other providers.

Prices are in USD per 1M tokens. Thinking tokens count as output tokens. Check the provider's price list before a run.

The tool writes `results/<time>-<model>/results.json` with every request and answer, and `report.html` with a summary table and the answers for each sample next to the expected meaning.

Latency is the full request time measured on the machine that runs the tool, so it includes the network path to the provider's region.
