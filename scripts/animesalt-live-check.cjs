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
  liveCalls.push({ url: String(url), status: response.status, length: body.length, snippet: body.slice(0, 500), title: body.includes('<title') ? body.split('<title')[1].split('</title>')[0].replace(/>/g, '').slice(0, 120) : '', hrefs: body.split('href=').slice(1, 11).map((x) => x.slice(0, 120)), watchCount: body.split('/watch/').length - 1, articleCount: body.split('<article').length - 1 });
  return { status: response.status, body: body };
};

const provider = require('../providers/animesalt.js');

async function main() {
  console.log('[AnimeSalt live] Probing public search route variants...');
  for (const url of ['https://animesalt.to/search?keyword=Naruto','https://animesalt.to/filter?keyword=Naruto','https://animesalt.to/?s=Naruto','https://animesalt.to/ajax/search/suggest?keyword=Naruto']) {
    const response = await global.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 10000 });
    console.log('[AnimeSalt live] Probe:', JSON.stringify(liveCalls[liveCalls.length - 1]));
  }
  const filterProbe = await global.fetch('https://animesalt.to/filter?keyword=Naruto&page=1', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 12000 });
  const watchMarker = '/watch/';
  const watchIndex = filterProbe.body.indexOf(watchMarker);
  let liveWatchUrl = '';
  if (watchIndex >= 0) {
    const hrefStart = filterProbe.body.lastIndexOf('href="', watchIndex) + 6;
    const hrefEnd = filterProbe.body.indexOf('"', watchIndex);
    if (hrefStart >= 6 && hrefEnd > watchIndex) liveWatchUrl = new URL(filterProbe.body.slice(hrefStart, hrefEnd), 'https://animesalt.to').href;
  }
  console.log('[AnimeSalt live] Filter probe:', JSON.stringify({status: filterProbe.status, length: filterProbe.body.length, watchUrl: liveWatchUrl, watchCount: filterProbe.body.split('/watch/').length - 1, cardSnippets: filterProbe.body.split('/watch/').slice(1, 4).map((x) => x.slice(0, 260))}));
  if (liveWatchUrl) {
    const watchPage = await global.fetch(liveWatchUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://animesalt.to/' }, timeoutMs: 12000 });
    const body = watchPage.body || '';
    const episodeListProbe = await global.fetch('https://animesalt.to/ajax/episode/list/7174', { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': liveWatchUrl, 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 12000 });
    let episodeListJson = null;
    try { episodeListJson = JSON.parse(episodeListProbe.body); } catch (_) {}
    const episodeListHtml = episodeListJson && typeof episodeListJson.result === 'string' ? episodeListJson.result : episodeListProbe.body;
    const episodeHtml = episodeListJson && typeof episodeListJson.html === 'string' ? episodeListJson.html : '';
    const encodedEpisodeId = episodeHtml.split('data-id="')[1] ? episodeHtml.split('data-id="')[1].split('"')[0] : '';
    console.log('[AnimeSalt live] Episode ID extracted:', encodedEpisodeId ? 'yes' : 'no', '| encoded length:', encodedEpisodeId.length);
    for (const route of [
      '/ajax/episode/servers?episodeId=' + encodeURIComponent(encodedEpisodeId),
      '/ajax/server/list?servers=' + encodeURIComponent(encodedEpisodeId),
      '/ajax/server?get=' + encodeURIComponent(encodedEpisodeId)
    ]) {
      const probe = await global.fetch('https://animesalt.to' + route, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': liveWatchUrl, 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 12000 });
      let parsed = null; try { parsed = JSON.parse(probe.body); } catch (_) {}
      console.log('[AnimeSalt live] Server-route probe:', JSON.stringify({
        route, status: probe.status, length: probe.body.length,
        jsonKeys: parsed ? Object.keys(parsed) : [],
        htmlLength: parsed && typeof parsed.html === 'string' ? parsed.html.length : 0,
        resultType: parsed && typeof parsed.result,
        snippet: (parsed && (parsed.html || parsed.result) || probe.body).slice(0, 350)
      }));
    if (route.startsWith('/ajax/server/list') && parsed && typeof parsed.html === 'string') {
      const serverHtml = parsed.html;
      const ids = serverHtml.split('data-link-id="').slice(1).map((part) => part.split('"')[0]).filter(Boolean);
      console.log('[AnimeSalt live] Server list details:', JSON.stringify({
        dataTypeCount: serverHtml.split('data-type="').length - 1,
        linkCount: ids.length,
        firstIds: ids.slice(0, 5),
        serverHtml: serverHtml.slice(0, 1800)
      }));
      if (ids[0]) {
        const resolved = await global.fetch('https://animesalt.to/ajax/server?get=' + encodeURIComponent(ids[0]), { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': liveWatchUrl, 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 12000 });
        let resolvedJson = null; try { resolvedJson = JSON.parse(resolved.body); } catch (_) {}
        const resultUrl = resolvedJson && resolvedJson.result && resolvedJson.result.url;
        console.log('[AnimeSalt live] Server resolve:', JSON.stringify({
          status: resolved.status, jsonKeys: resolvedJson ? Object.keys(resolvedJson) : [],
          resultType: resolvedJson && typeof resolvedJson.result,
          urlHost: resultUrl ? new URL(resultUrl).host : null,
          urlPath: resultUrl ? new URL(resultUrl).pathname : null,
          snippet: resolved.body.slice(0, 500)
        }));
      }
    }
    }
    console.log('[AnimeSalt live] AJAX markers:', JSON.stringify(
      ['/ajax/episode/servers', '/ajax/server?get=', '/ajax/server/list', '/ajax/episode/list/'].map((marker) => {
        const at = body.indexOf(marker); return {marker, snippet: at >= 0 ? body.slice(Math.max(0, at - 100), at + 180) : ''};
      })
    ));
    console.log('[AnimeSalt live] Episode-list endpoint:', JSON.stringify({
      status: episodeListProbe.status, length: episodeListProbe.body.length,
      jsonStatus: episodeListJson && episodeListJson.status,
      resultType: episodeListJson && typeof episodeListJson.result,
      dataIds: episodeListHtml.split('data-ids=').length - 1,
      episodeLinks: episodeListHtml.split('data-num=').length - 1,
      snippet: episodeListHtml.slice(0, 900)
    }));
    console.log('[AnimeSalt live] Watch-page markers:', JSON.stringify({
      status: watchPage.status, length: body.length,
      dataId: body.includes('data-id='),
      episodeListEndpoint: body.includes('/ajax/episode/list/'),
      dataIds: body.includes('data-ids='),
      subFlag: body.includes('data-sub='),
      dubFlag: body.includes('data-dub='),
      iframeCount: body.split('<iframe').length - 1,
      snippets: ['data-id=', '/ajax/episode/list/', 'data-ids=', 'iframe'].map((marker) => {
        const at = body.indexOf(marker); return at >= 0 ? body.slice(Math.max(0, at - 80), at + 180) : '';
      })
    }));
  }
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
