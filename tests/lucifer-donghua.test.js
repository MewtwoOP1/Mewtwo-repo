'use strict';

const assert = require('node:assert/strict');
const provider = require('../providers/lucifer-donghua.js');

const site = 'https://luciferdonghua.in';
const seriesPath = '/anime/soul-land-2-the-peerless-tang-sect-new-2023/';
const episodePath = '/soul-land-2-the-peerless-tang-sect-episode-176-lucifer-donghua/';
const requests = [];
const nativeFetch = global.fetch;
const hls = '#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXTINF:8,\nsegment-1.ts\n#EXT-X-ENDLIST\n';

function response(url, body, status) {
  return { status: status || 200, body: body, url: url };
}
function seriesCard() {
  return '<div class="bsx"><a href="' + seriesPath + '" title="Soul Land 2: The Peerless Tang Sect (2023)">' +
    '<img data-src="https://img.example/poster.jpg" alt="Soul Land 2: The Peerless Tang Sect (2023)">' +
    '<div class="tt">Soul Land 2: The Peerless Tang Sect (2023)</div></a></div>';
}
function episode(number, date) {
  return '<li><a href="/soul-land-2-the-peerless-tang-sect-episode-' + number + '-lucifer-donghua/">' +
    '<span class="epl-num">' + number + ' [4K]</span><span class="epl-title">Episode ' +
    number + '</span><span class="epl-date">' + date + '</span></a></li>';
}
function encodedIframe(url) {
  return Buffer.from('<div id="embed_holder"><iframe src="' + url + '"></iframe></div>').toString('base64');
}
function episodeHtml() {
  return '<div class="mirror"><select class="mirror">' +
    '<option data-index="1" value="https://luciferdonghua.in/soul-land-2-episode-3/v/1/">Dailymotion</option>' +
    '<option data-index="2" value="' + encodedIframe('https://rumble.com/embed/vabc123/') + '">Rumble</option>' +
    '<option data-index="3" value="' + encodedIframe('https://ok.ru/videoembed/123') + '">Ok.ru</option>' +
    '</select></div>';
}
function detailHtml() {
  return '<html><head><title>Soul Land 2: The Peerless Tang Sect (2023) - Lucifer Donghua.in</title>' +
    '<meta property="og:title" content="Soul Land 2: The Peerless Tang Sect (2023)">' +
    '<meta property="og:image" content="https://img.example/soul-land-cover.jpg">' +
    '<meta name="description" content="Soul Land 2 synopsis."></head><body>' +
    '<h1>Soul Land 2: The Peerless Tang Sect (2023)</h1>' +
    '<div class="info-content"><div class="info-left"><span>Status: Ongoing</span><span>Studio: Sparkly Key Animation</span>' +
    '<a href="/genre/fantasy/">Fantasy</a><a href="/genre/action/">Action</a></div></div>' +
    '<div class="desc">A fantasy adventure on the Douluo Continent.</div><div class="eplister"><ul>' +
    episode(176, 'October 23, 2026') + episode(177, 'October 19, 2026') +
    episode(175, 'October 16, 2026') + '</ul></div></body></html>';
}

global.fetch = async function (input, options) {
  const url = String(input);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:', 'provider should only make HTTPS requests');
  requests.push({ url: url, options: options || {} });

  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/page/1/' && parsed.searchParams.has('s')) {
    return response(url, 'primary search route unavailable', 404);
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/' && parsed.searchParams.has('s')) {
    return response(url, '<html><body><div class="listupd">' + seriesCard() + '</div></body></html>');
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/anime/' &&
      (parsed.searchParams.get('order') === 'popular' || parsed.searchParams.get('order') === 'update')) {
    return response(url, '<html><body><div class="listupd">' + seriesCard() + '</div></body></html>');
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === seriesPath) return response(url, detailHtml());
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === episodePath) return response(url, episodeHtml());

  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/soul-land-2-episode-3/v/1/') {
    // Current live-site shape: advertising iframes precede the player, which is
    // published in meta[itemprop=embedUrl].
    return response(url, '<iframe src="https://t.co/ad-redirect"></iframe>' +
      '<iframe src="https://nblmoviess.blogspot.com/hidden-ad"></iframe>' +
      '<meta itemprop="embedUrl" content="https://geo.dailymotion.com/player/xdcdz.html?video=x1testabc">');
  }
  if (parsed.hostname === 'geo.dailymotion.com' && parsed.pathname === '/player/xdcdz.html') {
    return response(url, '<script>var dmInternalData = {"ts":"12345","v1st":"visitor-test"};</script>');
  }
  if (parsed.hostname === 'www.dailymotion.com' && parsed.pathname === '/player/metadata/video/x1testabc') {
    return response(url, JSON.stringify({ qualities: {
      auto: [{ url: 'https://cdn.example/dm-auto.m3u8', type: 'application/vnd.apple.mpegurl' }],
      '720': [{ url: 'https://cdn.example/dm720.m3u8', type: 'application/vnd.apple.mpegurl' }]
    }, subtitles: { data: [] } }));
  }
  if (parsed.hostname === 'rumble.com' && parsed.pathname === '/hls-vod/abc123/playlist.m3u8') return response(url, hls);
  if (parsed.hostname === 'ok.ru' && parsed.pathname === '/videoembed/123') {
    return response(url, '<div data-options="{&quot;ondemandHls&quot;:&quot;https:\\/\\/cdn.example\\/okru.m3u8&quot;}"></div>');
  }
  if (parsed.hostname === 'cdn.example' && /\.m3u8$/.test(parsed.pathname)) return response(url, hls);
  return response(url, 'not found', 404);
};

async function main() {
  const info = provider.getInfo();
  assert.equal(info.name, 'Lucifer Donghua');
  assert.equal(info.lang, 'en');
  assert.equal(info.baseUrl, site);
  assert.equal(info.version, '1.0.2');

  const settings = provider.getSettings();
  assert.deepEqual(settings.map(function (item) { return item.key; }), [
    'preferred_quality', 'luciferdonghua_hoster_selection', 'luciferdonghua_ignore_preview'
  ]);
  assert.equal(settings[0].default, '720p');
  assert.deepEqual(settings[1].default, ['dailymotion', 'rumble', 'ok.ru']);
  assert.equal(settings[2].default, true);

  // Regression: search must retry if Yuzono's primary route has no cards.
  const results = await provider.search('Soul Land', 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'soul-land-2-the-peerless-tang-sect-new-2023');
  assert.equal(results[0].title, 'Soul Land 2: The Peerless Tang Sect (2023)');
  assert.equal(results[0].cover, 'https://img.example/poster.jpg');
  assert.ok(requests.some(function (r) { return r.url.indexOf('/page/1/?s=Soul%20Land') >= 0; }));
  assert.ok(requests.some(function (r) { return r.url.indexOf('/?s=Soul%20Land') >= 0; }));

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.equal(home[0].title, 'Popular');
  assert.equal(home[1].title, 'Latest Updates');

  // Regression: current pages can have a generic h1 and nested info-content.
  const slug = 'soul-land-2-the-peerless-tang-sect-new-2023';
  const detail = await provider.getDetail(slug);
  assert.equal(detail.title, 'Soul Land 2: The Peerless Tang Sect (2023)');
  assert.equal(detail.cover, 'https://img.example/soul-land-cover.jpg');
  assert.equal(detail.status, 'ongoing');
  assert.deepEqual(detail.genres, ['Fantasy', 'Action']);
  assert.match(detail.description, /fantasy adventure/i);
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 176);

  const allEpisodes = await provider.getEpisodes(slug, { luciferdonghua_ignore_preview: false });
  assert.equal(allEpisodes.length, 3);
  assert.equal(allEpisodes[0].number, 176);

  const streams = await provider.getVideoSources(site + episodePath);
  assert.ok(streams.length >= 4);
  assert.ok(streams.some(function (item) { return item.url === 'https://rumble.com/hls-vod/abc123/playlist.m3u8'; }));
  assert.ok(streams.some(function (item) { return item.url === 'https://cdn.example/okru.m3u8'; }));
  assert.ok(streams.some(function (item) { return item.url === 'https://cdn.example/dm720.m3u8' && item.quality === '720p'; }));
  assert.equal(streams[0].quality, '720p');
  assert.ok(streams.every(function (item) { return item.headers && item.headers.Referer; }));

  const onlyDailymotion = await provider.getVideoSources(site + episodePath,
    { luciferdonghua_hoster_selection: ['dailymotion'] });
  assert.ok(onlyDailymotion.length >= 1);
  assert.ok(onlyDailymotion.every(function (item) { return item.label.indexOf('Dailymotion') >= 0; }));
  const noHosts = await provider.getVideoSources(site + episodePath, { luciferdonghua_hoster_selection: [] });
  assert.equal(noHosts.length, 0);

  assert.ok(requests.every(function (r) { return r.options.headers && r.options.headers['User-Agent']; }));
  console.log('[PASS] Search fallback, current-style metadata, episode parsing, provider settings, and host extraction');
  console.log('[PASS] Mocked HTTP requests: ' + requests.length);
}

main().catch(function (error) {
  console.error('[FAIL] Lucifer Donghua: ' + (error && error.stack || error));
  process.exitCode = 1;
}).finally(function () { global.fetch = nativeFetch; });
