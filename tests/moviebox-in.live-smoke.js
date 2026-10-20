const assert = require('node:assert/strict');
const provider = require('../providers/moviebox-in.js');

const nativeFetch = global.fetch;
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
  originalWarn(...args);
};
global.fetch = (url, options = {}) => nativeFetch(url, {
  ...options,
  signal: AbortSignal.timeout(Math.min(Number(options.timeoutMs) || 10000, 15000))
});

async function main() {
  const rows = await provider.getHome({});
  const items = (rows || []).flatMap(row => row && Array.isArray(row.items) ? row.items : []);
  if (!items.length && warnings.some(message => /Service not available in current region/i.test(message))) {
    console.log('LIVE MOVIEBOX IN CHECK SKIPPED: both API domains appear region-restricted from this CI runner; run the same check from an India-based network.');
    return;
  }
  assert.ok(items.length > 0, 'Live API returned no home catalogue items.');

  const query = String(items[0].title || '').trim();
  assert.ok(query, 'First live home item has no title.');
  const searchResults = await provider.search(query, 1, {});
  assert.ok(searchResults.length > 0, 'Live search returned no results for a title from the home catalogue.');

  let playable = null;
  const metadata = [];
  for (const item of items.slice(0, 6)) {
    const detail = await provider.getDetail(item.url, {});
    if (!detail || !detail.title) continue;
    metadata.push({
      title: detail.title,
      type: detail.type,
      year: detail.year || null,
      hasCover: Boolean(detail.cover),
      hasDescription: Boolean(detail.description),
      genreCount: Array.isArray(detail.genres) ? detail.genres.length : 0,
      actorCount: Array.isArray(detail.actors) ? detail.actors.length : 0,
      episodeCount: Array.isArray(detail.episodes) ? detail.episodes.length : 0
    });
    const episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
    if (!episodes.length) continue;
    const streams = await provider.getVideoSources(episodes[0].url, {});
    if (streams && streams.length) {
      playable = {
        title: detail.title,
        episode: episodes[0].title,
        streamCount: streams.length,
        firstStream: {
          quality: streams[0].quality,
          container: streams[0].container,
          hasHeaders: Boolean(streams[0].headers),
          subtitleCount: Array.isArray(streams[0].subtitles) ? streams[0].subtitles.length : 0
        }
      };
      break;
    }
  }

  assert.ok(metadata.length > 0, 'Live detail endpoint returned no usable metadata.');
  assert.ok(playable, 'Live metadata worked, but no tested home item returned a playable stream.');
  console.log('LIVE MOVIEBOX IN SMOKE TEST PASSED');
  console.log(JSON.stringify({
    homeRows: rows.length,
    homeItems: items.length,
    searchQuery: query,
    searchResults: searchResults.length,
    metadataSamples: metadata.slice(0, 4),
    playback: playable
  }, null, 2));
}

main().catch(error => {
  console.error('LIVE MOVIEBOX IN SMOKE TEST FAILED:', error && error.stack || error);
  process.exitCode = 1;
});
