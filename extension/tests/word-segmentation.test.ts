import { describe, expect, it } from 'vitest';

import {
  getEnglishWordAtOffset,
  getEnglishWordSpanAtOffset,
} from '../src/word-segmentation';

describe('getEnglishWordSpanAtOffset', () => {
  it.each([
    { text: 'Hello world', offset: 0, expected: { start: 0, end: 5 } },
    { text: 'Hello world', offset: 8, expected: { start: 6, end: 11 } },
    { text: "I can't wait", offset: 2, expected: { start: 2, end: 7 } },
    { text: 'I can’t wait', offset: 6, expected: { start: 2, end: 7 } },
  ])(
    'returns the English word span at $offset in $text',
    ({ text, offset, expected }) => {
      expect(getEnglishWordSpanAtOffset(text, offset)).toEqual(expected);
    },
  );

  it.each([
    { text: '', offset: 0 },
    { text: 'Hello', offset: -1 },
    { text: 'Hello', offset: 5 },
    { text: 'Hello world', offset: 5 },
    { text: "can't", offset: 3 },
    { text: 'abc123', offset: 1 },
    { text: 'Привет', offset: 0 },
  ])('returns no English word span at $offset in $text', ({ text, offset }) => {
    expect(getEnglishWordSpanAtOffset(text, offset)).toBeNull();
  });
});

describe('getEnglishWordAtOffset', () => {
  it.each([
    {
      name: 'first character',
      text: 'Hello world',
      offset: 0,
      expected: 'Hello',
    },
    {
      name: 'last character of first word',
      text: 'Hello world',
      offset: 4,
      expected: 'Hello',
    },
    {
      name: 'middle of second word',
      text: 'Hello world',
      offset: 8,
      expected: 'world',
    },
    {
      name: 'last character in text',
      text: 'Hello world',
      offset: 10,
      expected: 'world',
    },
    {
      name: 'straight-apostrophe contraction',
      text: "I can't wait",
      offset: 2,
      expected: "can't",
    },
    {
      name: 'curly-apostrophe contraction',
      text: 'I can’t wait',
      offset: 2,
      expected: 'can’t',
    },
    {
      name: 'word surrounded by punctuation',
      text: '"Hello"',
      offset: 1,
      expected: 'Hello',
    },
  ])('returns the word at the $name', ({ text, offset, expected }) => {
    expect(getEnglishWordAtOffset(text, offset)).toBe(expected);
  });

  it.each([
    { name: 'empty text', text: '', offset: 0 },
    { name: 'negative offset', text: 'Hello', offset: -1 },
    { name: 'offset at text length', text: 'Hello', offset: 5 },
    { name: 'fractional offset', text: 'Hello', offset: 1.5 },
    { name: 'whitespace', text: 'Hello world', offset: 5 },
    { name: 'punctuation', text: 'Hello, world', offset: 5 },
    { name: 'contraction apostrophe', text: "can't", offset: 3 },
    { name: 'number', text: 'Version 123', offset: 8 },
    { name: 'alphanumeric token', text: 'abc123', offset: 2 },
    { name: 'non-Latin word', text: 'Привет', offset: 0 },
  ])('returns null for $name', ({ text, offset }) => {
    expect(getEnglishWordAtOffset(text, offset)).toBeNull();
  });
});
