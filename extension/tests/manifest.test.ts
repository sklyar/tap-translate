import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ManifestContentScript {
  readonly matches?: readonly string[];
  readonly js?: readonly string[];
  readonly run_at?: string;
  readonly all_frames?: boolean;
}

interface ExtensionManifest {
  readonly content_scripts?: readonly ManifestContentScript[];
}

describe('extension manifest', () => {
  it('injects the content script only into top-level HTTP(S) documents', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'),
    ) as ExtensionManifest;

    expect(manifest.content_scripts).toEqual([
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ]);
  });
});
