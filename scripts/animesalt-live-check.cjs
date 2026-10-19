// Manual/live smoke test for AnimeSalt. Uses the app-style fetch response shape.
const nativeFetch = global.fetch;
const liveCalls = [];
global.fetch = async function (url, options) {
  const init = Object.assign({}, options || {});
  const timeoutMs = Number(init.timeoutMs) || 12000;
  delete init.timeoutMs;
  if (!init.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  const response = await nativeFetch(url, init);
  const body = await response.text();
  liveCalls.push({ url: String(url), status: response.status, length: body.length, snippet: body.slice(0, 500) });
  return { status: response.status, body: body };
};

const provider = require('../providers/animesalt.js');

async function main() {
  console.log('[AnimeSalt live] Checking mirror selection and search...');
  const results = await provider.search('Naruto', 1, {});
  if (!Array.isArray(results) || results.length === 0) {
    console.log('[AnimeSalt live] Request diagnostics:', JSON.stringify(liveCalls.map(({url,status,length,snippet}) => ({url,status,length,snippet}))));
    throw new Error('AnimeSalt live search returned no results');
  }
  const series = results.find((item) => /\/series\//i.test(item.url)) || results[0];
  if (!series || !series.url) throw new Error('AnimeSalt live search returned malformed cards');
  console.log('[AnimeSalt live] Search passed; results:', results.length, '| selected:', series.title);

  console.log('[AnimeSalt live] Checking episode enumeration...');
  const detail = await provider.getDetail(series.url, { category: 'dub' });
  if (!detail || !Array.isArray(detail.episodes) || detail.episodes.length === 0) {
    throw new Error('AnimeSalt live detail returned no episodes for ' + series.title);
  }
  console.log('[AnimeSalt live] Detail passed; episodes:', detail.episodes.length);

  console.log('[AnimeSalt live] Resolving player to signed master...');
  const sources = await provider.getVideoSources(detail.episodes[0].url, {});
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('AnimeSalt live resolver returned no sources');
  const source = sources[0];
  if (!/^https?:\/\//i.test(source.url)) throw new Error('AnimeSalt live resolver returned an invalid URL');
  if (source.container !== 'hls') throw new Error('AnimeSalt live source is not HLS');
  const playlistResponse = await global.fetch(source.url, {
    headers: source.headers || {},
    timeoutMs: 12000
  });
  if (playlistResponse.status >= 400 || !/^\s*#EXTM3U/m.test(playlistResponse.body || '')) {
    throw new Error('AnimeSalt live master request failed with HTTP ' + playlistResponse.status);
  }
  const audioTracks = (playlistResponse.body.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/gi) || []).length;
  if (audioTracks < 2) {
    throw new Error('AnimeSalt live master did not expose multiple HLS audio tracks; observed ' + audioTracks);
  }
  console.log('[AnimeSalt live] PASS — signed HLS master reachable; audio rendition entries:', audioTracks);
}

main().catch((error) => {
  console.error('[AnimeSalt live] FAIL:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
