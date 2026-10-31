import { describe, it, expect } from 'vitest';
import { findTyposquatTarget, damerauLevenshtein } from '../src/core/typosquat.js';

describe('typosquat', () => {
  it('computes damerau-levenshtein', () => {
    expect(damerauLevenshtein('lodash', 'lodahs')).toBe(1);
    expect(damerauLevenshtein('react', 'raect')).toBe(1);
    expect(damerauLevenshtein('abc', 'xyz')).toBe(3);
  });
  it('flags near-misses of popular names', () => {
    expect(findTyposquatTarget('lodahs')).toBe('lodash');
    expect(findTyposquatTarget('expresss')).toBe('express');
    expect(findTyposquatTarget('crossenv')).toBe('cross-env');
  });
  it('does not flag popular names themselves or distant names', () => {
    expect(findTyposquatTarget('lodash')).toBeNull();
    expect(findTyposquatTarget('my-totally-unique-lib')).toBeNull();
  });
  it('ignores short names where distance is meaningless', () => {
    expect(findTyposquatTarget('qs')).toBeNull();
    expect(findTyposquatTarget('ws2')).toBeNull();
  });
});
