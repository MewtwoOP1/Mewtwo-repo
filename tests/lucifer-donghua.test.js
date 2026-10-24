'use strict';

const assert = require('node:assert/strict');
const provider = require('../providers/lucifer-donghua.js');

const site = 'https://luciferdonghua.in';
const requests = [];
const nativeFetch = global.fetch;
const hls = '#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXTINF:8,\nsegment-1.ts\n#EXT-X-ENDLIST\n';

function response(url, body, status) {
  return { status: status || 200, body: body, url: url };
}
function article(url, title) {
  return '<article><a class="tip" href="' + url + '"><img data-src="https://img.example/poster.jpg" alt="' + title +
    '"><div class="tt">' + title + '</div></a></article>';
}
function episode(number, date) {
  return '<li><a href="/soul-land-2-episode-' + number + '/"><span class="epl-num">' + number +
    ' [4K]</span><span class="epl-title">Episode ' + number + '</span><span class="epl-date">' + date +
    '</span></a></li>';
}
function encodedIframe(url) {
  return Buffer.from('<div id="embed_holder"><iframe src="' + url + '"></iframe></div>').toString('base64');
}
function episodeHtml() {
  return '<div class="mirror"><select class="mirror">' +
    '<option data-index="1" value="' + encodedIframe('https://www.dailymotion.com/embed/video/x1testabc') + '">Dailymotion</option>' +
    '<option data-index="2" value="' + encodedIframe('https://rumble.com/embed/vabc123/') + '">Rumble</option>' +
    '<option data-index="3" value="' + encodedIframe('https://ok.ru/videoembed/123') + '">Ok.ru</option>' +
    '</select></div>';
}

global.fetch = async function (input, options) {
  const url = String(input);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:', 'provider should only make HTTPS requests');
  requests.push({ url: url, options: options || {} });

  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/page/1/') {
    return response(url, article('/anime/soul-land-2/', 'Soul Land 2'));
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/anime/' && parsed.searchParams.get('order') === 'popular') {
    return response(url, article('/anime/soul-land-2/', 'Soul Land 2'));
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/anime/' && parsed.searchParams.get('order') === 'update') {
    return response(url, article('/anime/soul-land-2/', 'Soul Land 2'));
  }
  if (parsed.hostname === 'luciferdonghua.in' && parsed.pathname === '/anime/soul-land-2/') {
    return response(url, '<h1 class="entry-title">Soul Land 2: The Peerless Tang Sect</h1>' +
      '<div class="info-content"><span>Status: Ongoing</span><a href="/genre/fantasy/">Fantasy</a></div>' +
      '<div class="thumb"><img src="https://img.example/soul-land.jpg"></div><div class="desc">A fantasy adventure.</div>' +
      '<div class="eplister"><ul>' + episode(1, 'October 3, 2026') + episode(2, 'October 2, 2026') +
      episode(3, 'October 1, 2026') + '</ul></div>');
  }
  if (parsed.hostname === 'luciferdonghua.in' && /-episode-\d+\/?$/.test(parsed.pathname)) {
    return response(url, episodeHtml());
  }
  if (parsed.hostname === 'www.dailymotion.com' && parsed.pathname === '/embed/video/x1testabc') {
    return response(url, '<script>var dmInternalData = {"ts":"12345","v1st":"visitor-test"};</script>');
  }
  if (parsed.hostname === 'www.dailymotion.com' && parsed.pathname === '/player/metadata/video/x1testabc') {
    return response(url, JSON.stringify({ qualities: {
      auto: [{ url: 'https://cdn.example/dm-auto.m3u8', type: 'application/vnd.apple.mpegurl' }],
      '720': [{ url: 'https://cdn.example/dm720.m3u8', type: 'application/vnd.apple.mpegurl' }]
    }, subtitles: { data: [] } }));
  }
  if (parsed.hostname === 'rumble.com' && parsed.pathname === '/hls-vod/abc123/playlist.m3u8') {
    return response(url, hls);
  }
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
  assert.equal(info.version, '1.0.0');

  const settings = provider.getSettings();
  assert.deepEqual(settings.map(function (item) { return item.key; }), [
    'preferred_quality', 'luciferdonghua_hoster_selection', 'luciferdonghua_ignore_preview'
  ]);
  assert.equal(settings[0].default, '720p');
  assert.deepEqual(settings[1].default, ['dailymotion', 'rumble', 'ok.ru']);
  assert.equal(settings[2].default, true);

  const search = await provider.search('Soul Land', 1);
  assert.equal(search.length, 1);
  assert.equal(search[0].id, 'soul-land-2');
  assert.equal(search[0].title, 'Soul Land 2');

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.equal(home[0].title, 'Popular');
  assert.equal(home[1].title, 'Latest Updates');

  const detail = await provider.getDetail('https://luciferdonghua.in/anime/soul-land-2/');
  assert.equal(detail.title, 'Soul Land 2: The Peerless Tang Sect');
  assert.deepEqual(detail.genres, ['Fantasy']);
  assert.equal(detail.episodes.length, 2, 'date-based preview behavior should match upstream');
  assert.equal(detail.episodes[0].number, 2, 'preview filtering should order remaining episodes newest first');

  const allEpisodes = await provider.getEpisodes('soul-land-2', { luciferdonghua_ignore_preview: false });
  assert.equal(allEpisodes.length, 3, 'disabling preview skipping should retain every episode');
  assert.equal(allEpisodes[0].number, 1, 'disabled preview filtering preserves source-page order');

  const streams = await provider.getVideoSources('https://luciferdonghua.in/soul-land-2-episode-3/');
  assert.ok(streams.length >= 4, 'Dailymotion, Rumble, and Ok.ru should return candidates');
  assert.ok(streams.some(function (item) { return item.url === 'https://rumble.com/hls-vod/abc123/playlist.m3u8'; }));
  assert.ok(streams.some(function (item) { return item.url === 'https://cdn.example/okru.m3u8'; }));
  assert.ok(streams.some(function (item) { return item.url === 'https://cdn.example/dm720.m3u8' && item.quality === '720p'; }));
  assert.equal(streams[0].quality, '720p', 'preferred quality should sort first');
  assert.ok(streams.every(function (item) { return item.headers && item.headers.Referer; }));

  const dailymotionOnly = await provider.getVideoSources(
    'https://luciferdonghua.in/soul-land-2-episode-3/',
    { luciferdonghua_hoster_selection: ['dailymotion'] }
  );
  assert.ok(dailymotionOnly.length >= 1);
  assert.ok(dailymotionOnly.every(function (item) { return item.label.indexOf('Dailymotion') >= 0; }),
    'disabled hosts should not appear in results');

  const noHosts = await provider.getVideoSources(
    'https://luciferdonghua.in/soul-land-2-episode-3/',
    { luciferdonghua_hoster_selection: [] }
  );
  assert.equal(noHosts.length, 0);

  assert.ok(requests.some(function (item) { return item.url.indexOf('/page/1/?s=Soul%20Land') >= 0; }));
  assert.ok(requests.every(function (item) { return item.options.headers && item.options.headers['User-Agent']; }));
  console.log('[PASS] Lucifer Donghua Zangetsu contract, settings, preview rule, and hoster extraction');
  console.log('[PASS] Mocked HTTP requests: ' + requests.length);
}

main().catch(function (error) {
  console.error('[FAIL] Lucifer Donghua: ' + (error && error.stack || error));
  process.exitCode = 1;
}).finally(function () {
  global.fetch = nativeFetch;
});
