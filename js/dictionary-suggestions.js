import { normalizeWord } from './parse.js';
import { EXTRA_ENTRIES } from './dictionary-extra.js';
import { createJsonCache } from './dictionary-data.js';

export function prefixMatches(words, prefix, limit = 8) {
  const matches = [];
  if (words.includes(prefix)) matches.push(prefix);
  for (const word of words) {
    if (word !== prefix && word.startsWith(prefix)) matches.push(word);
    if (matches.length >= limit) break;
  }
  return matches.slice(0, limit);
}

export function mergeSuggestions(prefix, dictionary, owned, limit = 8) {
  const own = new Set(owned.map(normalizeWord));
  const mine = prefixMatches([...own], prefix, 3);
  const combined = [...new Set([...(own.has(prefix) || dictionary.includes(prefix) ? [prefix] : []), ...mine, ...dictionary])];
  return combined.filter((word) => word.startsWith(prefix)).slice(0, limit).map((word) => ({ word, owned: own.has(word) }));
}

async function fetchIndex(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`data/dict/suggestions-v1/${path}`, { signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function createSuggestionLookup(load = fetchIndex) {
  const manifest = createJsonCache(() => load('index.json'), 1);
  const leaf = createJsonCache(load, 8);
  return async (value, owned = []) => {
    const prefix = normalizeWord(value);
    if (!/^[a-zà-öø-ÿ]+(?:[-' ][a-zà-öø-ÿ]*)*$/i.test(prefix) || prefix.length > 80) return { words: [], status: 'invalid' };
    const index = await manifest('index');
    let candidates = [];
    let status = index ? 'ok' : 'unavailable';
    if (index) {
      for (let length = 1; length <= prefix.length; length++) {
        const key = prefix.slice(0, length);
        if (Object.hasOwn(index.leaves, key)) {
          const words = await leaf(index.leaves[key]);
          status = words ? 'ok' : 'unavailable';
          candidates = prefixMatches(words || [], prefix);
          break;
        }
        if (length === prefix.length && Object.hasOwn(index.branches, key)) candidates = index.branches[key];
      }
    }
    const extras = prefixMatches(Object.keys(EXTRA_ENTRIES), prefix);
    return { words: mergeSuggestions(prefix, [...new Set([...candidates, ...extras])], owned), status };
  };
}

export const lookupSuggestions = createSuggestionLookup();
