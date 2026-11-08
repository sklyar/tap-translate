// Captures DetectionContext samples from real pages for the translation
// evaluation. It reads eval/sources.json and writes eval/contexts.json.
// See eval/README.md.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { webkit } from 'playwright';
import type { Page } from 'playwright';
import { build } from 'vite';

import type { DetectionContext } from '../src/detection';

interface Source {
  readonly id: string;
  readonly url: string;
  readonly license: string;
  readonly kind: string;
  readonly case: string;
  readonly quote: string;
  readonly word: string;
  readonly occurrence: number;
  readonly expected: string;
}

interface Sample {
  readonly id: string;
  readonly url: string;
  readonly license: string;
  readonly kind: string;
  readonly case: string;
  readonly word: string;
  readonly expected: string;
  readonly context: DetectionContext;
}

interface WordTarget {
  readonly quote: string;
  readonly word: string;
  readonly occurrence: number;
  // When true, the page scrolls so that the word is in the middle of the
  // viewport. When false, the position is only measured.
  readonly scroll: boolean;
}

type LocateResult =
  | { readonly ok: true; readonly x: number; readonly y: number }
  | { readonly ok: false; readonly error: string };

const evalDirectory = resolve(import.meta.dirname, '../../eval');
const sourcesPath = resolve(evalDirectory, 'sources.json');
const contextsPath = resolve(evalDirectory, 'contexts.json');
const capturePagePath = resolve(import.meta.dirname, 'capture-page.ts');

// A pause between page loads keeps the request rate low for the source sites.
const pageDelayMs = 2_000;
const pageTimeoutMs = 60_000;
const loadTimeoutMs = 15_000;

async function main(): Promise<void> {
  const sources = parseSources(
    JSON.parse(await readFile(sourcesPath, 'utf8')) as unknown,
  );
  const captureScript = await bundleCaptureScript();
  const samples: Sample[] = [];
  const failures: string[] = [];

  const browser = await webkit.launch();
  try {
    // bypassCSP lets the injected capture script run on pages with a strict
    // script-src policy.
    const browserContext = await browser.newContext({
      bypassCSP: true,
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    await browserContext.addInitScript({ content: captureScript });
    const page = await browserContext.newPage();

    let firstPage = true;
    for (const [url, group] of groupByUrl(sources)) {
      if (!firstPage) {
        await delay(pageDelayMs);
      }
      firstPage = false;

      console.log(`Opening ${url}`);
      const pageError = await openPage(page, url);

      if (pageError !== null) {
        failures.push(...group.map((source) => `${source.id}: ${pageError}`));
        continue;
      }

      for (const source of group) {
        const result = await captureSample(page, source);
        if (typeof result === 'string') {
          failures.push(`${source.id}: ${result}`);
        } else {
          samples.push(result);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`Failed to capture ${String(failures.length)} samples:`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    console.error(`${contextsPath} was not changed.`);
    process.exitCode = 1;
    return;
  }

  await writeFile(contextsPath, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`Wrote ${String(samples.length)} samples to ${contextsPath}`);
}

async function openPage(page: Page, url: string): Promise<string | null> {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: pageTimeoutMs,
    });

    if (response === null) {
      return 'the page returned no response';
    }

    // Images and fonts change the layout, so wait for them. A resource that
    // never finishes must not fail the page, because the text is already there.
    await page
      .waitForLoadState('load', { timeout: loadTimeoutMs })
      .catch(() => undefined);

    return response.ok()
      ? null
      : `the page returned HTTP ${String(response.status())}`;
  } catch (error) {
    return `the page did not load: ${errorMessage(error)}`;
  }
}

async function captureSample(
  page: Page,
  source: Source,
): Promise<Sample | string> {
  try {
    const wordTarget = {
      quote: source.quote,
      word: source.word,
      occurrence: source.occurrence,
    };
    const target = await page.evaluate(locateWord, {
      ...wordTarget,
      scroll: true,
    });

    if (!target.ok) {
      return target.error;
    }

    await page.evaluate(() => {
      delete window.tapTranslateCapture;
      window.getSelection()?.removeAllRanges();
    });
    await page.mouse.click(target.x, target.y);

    // A late image, font, or banner can move the text between the measurement
    // and the click. Then the click can hit the same word in another place.
    const after = await page.evaluate(locateWord, {
      ...wordTarget,
      scroll: false,
    });
    if (
      !after.ok ||
      Math.abs(after.x - target.x) > 0.5 ||
      Math.abs(after.y - target.y) > 0.5
    ) {
      return 'the word moved during the click; run the capture again';
    }

    const state = await page.evaluate(() => window.tapTranslateCapture);
    if (state === undefined) {
      return 'the click did not reach the capture listener';
    }

    if (state.context === null) {
      return 'detection returned no result';
    }

    const focusBlock = state.context.focusBlock;
    const detectedWord = focusBlock.text.slice(
      focusBlock.word.start,
      focusBlock.word.end,
    );

    if (detectedWord !== source.word) {
      return `detection found "${detectedWord}" instead of "${source.word}"`;
    }

    return {
      id: source.id,
      url: source.url,
      license: source.license,
      kind: source.kind,
      case: source.case,
      word: source.word,
      expected: source.expected,
      context: state.context,
    };
  } catch (error) {
    return errorMessage(error);
  }
}

// Runs in the page. Finds the quote in the page text, then returns the
// viewport center of the requested word occurrence inside the quote.
function locateWord(target: WordTarget): LocateResult {
  const ignoredParents = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const positions: { readonly node: Text; readonly offset: number }[] = [];
  const characters: string[] = [];
  let previousIsSpace = false;

  // Whitespace runs collapse to one space, so the quote does not depend on
  // line breaks and indentation in the HTML source. The characters go to an
  // array: appending to a string and checking its end on each step is
  // quadratic on pages with hundreds of thousands of characters.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (
      !(node instanceof Text) ||
      ignoredParents.has(node.parentElement?.tagName ?? '')
    ) {
      continue;
    }

    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data.charAt(offset);
      const isSpace = /\s/.test(character);
      if (isSpace && previousIsSpace) {
        continue;
      }
      characters.push(isSpace ? ' ' : character);
      positions.push({ node, offset });
      previousIsSpace = isSpace;
    }
  }

  const text = characters.join('');

  const quote = target.quote.replace(/\s+/g, ' ').trim();
  const quoteStart = text.indexOf(quote);
  if (quoteStart < 0) {
    return { ok: false, error: 'the quote is not on the page' };
  }

  if (text.includes(quote, quoteStart + 1)) {
    return { ok: false, error: 'the quote is not unique on the page' };
  }

  const escapedWord = target.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordPattern = new RegExp(
    `(?<![A-Za-z])${escapedWord}(?![A-Za-z])`,
    'g',
  );
  const match = [...quote.matchAll(wordPattern)][target.occurrence - 1];
  if (match === undefined) {
    return {
      ok: false,
      error: `occurrence ${String(target.occurrence)} of the word is not in the quote`,
    };
  }

  // The click goes to the center of the middle character. Adjacent character
  // rectangles can overlap by a pixel, and a point on a character boundary
  // can hit two characters.
  const middle =
    positions[quoteStart + match.index + Math.floor(target.word.length / 2)];
  if (middle === undefined) {
    return { ok: false, error: 'the word position is outside the page text' };
  }

  const range = document.createRange();
  range.setStart(middle.node, middle.offset);
  range.setEnd(middle.node, middle.offset + 1);

  if (target.scroll) {
    // The parent element scrolls first, so that nested scroll containers show
    // it. If the parent is taller than the viewport, the window then scrolls by
    // the character rectangle. Some pages set scroll-behavior: smooth, so the
    // scrolls are instant: the rectangle below must match the click time.
    middle.node.parentElement?.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    const characterRect = range.getClientRects()[0];
    if (
      characterRect !== undefined &&
      (characterRect.top < 0 || characterRect.bottom > window.innerHeight)
    ) {
      window.scrollBy({
        top:
          characterRect.top + characterRect.height / 2 - window.innerHeight / 2,
        behavior: 'instant',
      });
    }
  }

  const rect = range.getClientRects()[0];
  if (rect === undefined || rect.width === 0 || rect.height === 0) {
    return { ok: false, error: 'the word is not visible' };
  }

  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    return { ok: false, error: 'the word is outside the viewport' };
  }

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const element = document.elementFromPoint(x, y);
  if (element?.contains(middle.node) !== true) {
    return {
      ok: false,
      error: `another element covers the word: ${element?.tagName ?? 'none'}`,
    };
  }

  return { ok: true, x, y };
}

async function bundleCaptureScript(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    build: {
      write: false,
      minify: false,
      target: 'safari15.4',
      lib: {
        entry: capturePagePath,
        name: 'TapTranslateCapture',
        formats: ['iife'],
        fileName: () => 'capture-page.js',
      },
    },
  });

  for (const result of Array.isArray(output) ? output : [output]) {
    if (!('output' in result)) {
      continue;
    }

    for (const item of result.output) {
      if (item.type === 'chunk') {
        return item.code;
      }
    }
  }

  throw new Error('Vite did not produce the capture script.');
}

function groupByUrl(sources: readonly Source[]): Map<string, Source[]> {
  const groups = new Map<string, Source[]>();
  for (const source of sources) {
    const group = groups.get(source.url);
    if (group === undefined) {
      groups.set(source.url, [source]);
    } else {
      group.push(source);
    }
  }
  return groups;
}

function parseSources(value: unknown): Source[] {
  if (!Array.isArray(value)) {
    throw new Error(`${sourcesPath} must contain a JSON array.`);
  }

  const ids = new Set<string>();
  return value.map((item: unknown, index): Source => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Source ${String(index)} must be an object.`);
    }

    const record = item as Record<string, unknown>;
    const field = (name: string): string => {
      const fieldValue = record[name];
      if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
        throw new Error(
          `Source ${String(index)} must have a non-empty string "${name}".`,
        );
      }
      return fieldValue;
    };

    const occurrence = record.occurrence ?? 1;
    if (
      typeof occurrence !== 'number' ||
      !Number.isInteger(occurrence) ||
      occurrence < 1
    ) {
      throw new Error(
        `Source ${String(index)} must have a positive integer "occurrence".`,
      );
    }

    const id = field('id');
    if (ids.has(id)) {
      throw new Error(`Source id "${id}" is not unique.`);
    }
    ids.add(id);

    return {
      id,
      url: field('url'),
      license: field('license'),
      kind: field('kind'),
      case: field('case'),
      quote: field('quote'),
      word: field('word'),
      occurrence,
      expected: field('expected'),
    };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
