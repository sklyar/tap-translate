# TapTranslate API

Status: draft for review, 2026-11-08. Nothing implements it yet. It is stage 3 in the [roadmap](roadmap.md).

This is the contract between the Safari extension and the backend service. The extension sends the context of one tap. The service returns the translation.

## Principles

- The request and the response use the types that already exist: `TranslationRequest` and `TranslationResult` in `extension/src/translation.ts`, and `DetectionContext` and `Result` in `backend/internal/translation`. The API adds only the limits, the error format, and the compatibility rules.
- The service is never older than the extension that calls it. A change goes to the service first, and only then an extension version uses it.
- Old extension versions stay in use for months, because App Store updates are slow. The service keeps support for every API version that these extension versions use.
- Page text is private data of the user. The service does not store it and does not write it to logs. Error messages never contain it.

## Transport

- HTTPS only. The body is JSON in UTF-8 with `Content-Type: application/json`.
- The extension background script sends the request, not the content script. A request from a content script is subject to the CORS rules of the page origin, and the page CSP can block it, as it blocks inline styles of the sheet (see the README).
- There is one endpoint: `POST /v1/translate`.

## Request

```json
{
  "context": {
    "beforeBlocks": [
      {
        "text": "Chapter one",
        "truncatedBefore": false,
        "truncatedAfter": false
      }
    ],
    "focusBlock": {
      "text": "We sat on the bank of the river.",
      "word": { "start": 14, "end": 18 },
      "sentence": { "start": 0, "end": 32 },
      "truncatedBefore": false,
      "truncatedAfter": false
    },
    "afterBlocks": []
  }
}
```

The body is `TranslationRequest`. `context` is the `DetectionContext` that detection builds.

The service checks these rules. If a rule fails, it returns `400 invalid_request`.

| Field                                 | Rule                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| whole body                            | At most 64 KiB, else `413 request_too_large`. All fields are required, `null` is not allowed, and an unknown field is an error.                                    |
| `context.beforeBlocks`, `afterBlocks` | An array of 0 or 1 block. The extension sends at most one neighbor block on each side.                                                                             |
| neighbor block `text`                 | Not empty, at most 2,000 UTF-16 code units.                                                                                                                        |
| `context.focusBlock.text`             | Not empty, at most 4,000 UTF-16 code units.                                                                                                                        |
| `word`, `sentence`                    | Half-open ranges `[start, end)` of UTF-16 code units, the same as JavaScript string offsets. The sentence is inside the text, and the word is inside the sentence. |
| the tapped word                       | The text of the `word` range matches `^[A-Za-z]+(?:['’][A-Za-z]+)*$`, the same rule as `word-segmentation.ts`.                                                     |
| `truncatedBefore`, `truncatedAfter`   | Booleans. `true` means that the extension cut the block on that side.                                                                                              |

The limits are the same as the extension limits in `context-extraction.ts`. The body limit allows the largest valid context even if every character is escaped as `\uXXXX`. The tight rules make it hard to use the service as a free proxy to the model.

## Response

On success, the status is `200` and the body is `TranslationResult`:

```json
{
  "expression": "bank",
  "partOfSpeech": "noun",
  "translation": "берег",
  "explanation": "Не банк: речь о береге реки."
}
```

| Field          | Guarantee                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expression`   | English, not empty, at most 100 characters.                                                                                                                                                                  |
| `partOfSpeech` | A code from the list in `PartsOfSpeech()` in `backend/internal/translation/result.go`, such as `noun` or `phrasal verb`. The extension maps the code to Russian text. Now the sheet shows the code as it is. |
| `translation`  | Russian, not empty, at most 100 characters.                                                                                                                                                                  |
| `explanation`  | Russian, not empty, at most 500 characters. The prompt asks for at most 100.                                                                                                                                 |

`ParseResult` in `backend/internal/translation` already checks that the fields are not empty, their lengths, and the `partOfSpeech` code. The service never returns an answer that fails these checks. The language of the fields comes from the prompt and is not checked.

## Errors

On an error, the status is 4xx or 5xx, and the body is:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "context.focusBlock.word: range [14, 40) is outside the text of 32 code units"
  }
}
```

- `code` is stable. The extension makes its decisions only on `code`.
- `message` is English text for developers. It names the field and the rule. It never contains page text. The extension never shows it to the user.

| Status | `code`              | When                                                                                              | The user can retry |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| 400    | `invalid_request`   | The body is not valid JSON, or a rule from the request table fails. It is a bug in the extension. | no                 |
| 413    | `request_too_large` | The body is larger than 64 KiB.                                                                   | no                 |
| 422    | `text_rejected`     | The model provider refused the text, for example because of its content policy.                   | no                 |
| 502    | `bad_model_answer`  | The model answer failed the response rules, also after one retry by the service.                  | yes                |
| 503    | `unavailable`       | The model provider is not available or is overloaded, or the service is shutting down.            | yes                |
| 504    | `timeout`           | The model did not answer in time.                                                                 | yes                |
| 500    | `internal`          | Any other error in the service.                                                                   | yes                |

These codes are reserved for client identification. API version 1 does not return them yet:

| Status | `code`         | When                                                                                    |
| ------ | -------------- | --------------------------------------------------------------------------------------- |
| 401    | `unauthorized` | The client did not identify itself, or its credentials are not valid.                   |
| 429    | `rate_limited` | The client sent too many requests. The `Retry-After` header says when it can try again. |

How the extension handles a response that is not a success:

- A known `code`: as the table says.
- An unknown `code`, or a body without the error object (for example, an HTML page from a proxy): by the status. 5xx can be retried, 4xx cannot.
- A network error or the client timeout: can be retried.

## Headers

- Every response, also an error, has `X-Request-Id` with a random ID. The service writes it to its logs. The extension can write it to its own log, so that one request can be found on both sides without page text.
- Every response has `Cache-Control: no-store`, because the answer comes from page text.

## Timeouts, cancellation, and retries

- The service returns a result or an error within 10 seconds. In the evaluation, p95 is 1.5–1.8 s.
- The extension timeout is 15 seconds, so the `timeout` error of the service comes first.
- The extension does not retry by itself. The user taps «Повторить» in the sheet. An automatic retry would double the cost of a request that the model provider can bill.
- A new tap or closing the sheet cancels the request. The service stops the model request when the client closes the connection.
- The service retries the model once when the answer fails the response rules and the deadline leaves time for it.

## Privacy

- Page text goes to the service and from the service to the model provider. Now the provider is Alibaba Cloud Model Studio in the Singapore region. The service uses the text only to build the prompt.
- The service does not store page text. Its logs contain the request ID, the status, the error code, the latency, the text lengths, and the token counts. They do not contain page text or the answer.

## Compatibility

- The path has the version: `/v1/`.
- In version 1, the service can add optional response fields, new `partOfSpeech` codes, and new error codes. The extension ignores unknown response fields, shows an unknown `partOfSpeech` code as it is, and handles an unknown error code by its status.
- In version 1, the service never removes or renames a response field and never makes a required field optional.
- The service rejects unknown request fields. This finds bugs in the extension early. It is safe, because a new optional request field goes to the service before any extension version sends it.
- A breaking change gets a new version, `/v2/`. The service keeps `/v1/` while extension versions that use it are in use.

## Not in version 1

- Client identification and rate limits. They come later and use the reserved codes `401` and `429`.
- A cache of answers. It changes how long the service keeps data that comes from page text, so it needs its own decision.
- Language pairs other than English to Russian. A later version can add an optional `targetLanguage` field.
- Streaming of the answer, so that the translation appears before the explanation.

## To check in stage 3

These are facts to check, not decisions:

- Can the background script call the service without CORS headers when `manifest.json` has `host_permissions` for the service? If Safari needs CORS, the origin of the extension is `safari-web-extension://<ID>`, and the ID is different for each installation.
- Can the extension call `http://127.0.0.1` for local development in Safari on macOS and in the iOS Simulator?
- How often does the content moderation of Model Studio reject real page text? All 54 evaluation samples passed.
