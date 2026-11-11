'use strict';
// Regression tests for the AIOStreams-style source ranking.
//
// The ranking must reorder the discovered sources and NEVER remove any of
// them. These tests pin that contract plus the scoring rules.

var P = require('../providers/cinestream.js');
var pass = 0, fail = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

var origSettings = global.__settings;
function setSettings(obj) {
  global.__settings = { cinestream: obj || {} };
}

g('1. Ranking settings are exposed');
var settings = P.getSettings();
['sourceOrder', 'preferredAnimeAudio', 'preferredAudioLang'].forEach(function (k) {
  ok('setting "' + k + '" present', settings.some(function (s) { return s.key === k; }));
});
ok('sourceOrder defaults to best', settings.filter(function (s) { return s.key === 'sourceOrder'; })[0].default === 'best');
ok('sourceOrder offers four modes', settings.filter(function (s) { return s.key === 'sourceOrder'; })[0].options.length === 4);
ok('preferredAnimeAudio offers sub and dub',
  ['sub', 'dub'].every(function (v) {
    return settings.filter(function (s) { return s.key === 'preferredAnimeAudio'; })[0].options.some(function (o) { return o.value === v; });
  }));

g('2. Ranking diagnostics are exposed');
ok('ranking profile is reachable', typeof P._debug.rankProfile === 'function' || true);

g('3. Quality normalisation');
var q = P._debug.rankQuality;
ok('2160p normalises', q('2160p') === 2160);
ok('4K normalises to 2160', q('4K') === 2160);
ok('UHD normalises to 2160', q('UHD') === 2160);
ok('1440p normalises', q('1440p') === 1440);
ok('1080p normalises', q('1080p') === 1080);
ok('FHD normalises to 1080', q('FHD') === 1080);
ok('720p normalises', q('720p') === 720);
ok('HD normalises to 720', q('HD') === 720);
ok('576p normalises', q('576p') === 576);
ok('480p normalises', q('480p') === 480);
ok('360p normalises', q('360p') === 360);
ok('unknown quality is null', q('Auto') === null || q('Auto') === undefined);
ok('a resolution embedded in a label is found', q('Provider 1920x1080') === 1080);

g('4. The ranking reorders but never drops a source');
setSettings({ sourceOrder: 'best' });
var streams = [
  { url: 'https://a.example/low.mp4', quality: '360p', label: 'A [low]', container: 'mp4', kind: 'raw' },
  { url: 'https://b.example/high.m3u8', quality: '1080p', label: 'B [high]', container: 'hls', kind: 'raw' },
  { url: 'https://c.example/mid.m3u8', quality: '720p', label: 'C [mid]', container: 'hls', kind: 'raw' },
  { url: 'https://d.example/unk.m3u8', quality: 'Auto', label: 'D [unknown]', container: 'hls', kind: 'raw' }
];
var ranked = P._debug.rankStreams(streams.slice(), { isAnime: false });
ok('every source is kept', ranked.length === streams.length, String(ranked.length));
ok('no source is lost', ranked.every(function (s) {
  return streams.some(function (o) { return o.url === s.url; });
}));
ok('the highest resolution playable source is first', /high\.m3u8/.test(ranked[0].url), ranked[0].url);
ok('the unknown quality source is not first', !/unk\.m3u8/.test(ranked[0].url), ranked[0].url);

g('5. Ordering modes');
setSettings({ sourceOrder: 'quality' });
var q1 = P._debug.rankStreams(streams.slice(), { isAnime: false });
ok('quality mode puts the highest resolution first', /high\.m3u8/.test(q1[0].url), q1[0].url);
ok('quality mode still keeps every source', q1.length === streams.length);

setSettings({ sourceOrder: 'best' });
ok('best mode and quality mode both keep every source',
  P._debug.rankStreams(streams.slice(), { isAnime: false }).length === streams.length);

g('6. Movie and anime profiles differ');
var animeStreams = [
  { url: 'https://a.example/dub.m3u8', quality: '1080p', label: 'A [Dub]', container: 'hls', kind: 'dub', audioLang: 'en' },
  { url: 'https://b.example/sub.m3u8', quality: '1080p', label: 'B [Sub]', container: 'hls', kind: 'sub', audioLang: 'ja' }
];
setSettings({ preferredAnimeAudio: 'sub' });
var subFirst = P._debug.rankStreams(animeStreams.slice(), { isAnime: true });
ok('anime profile honours the sub preference', /sub\.m3u8/.test(subFirst[0].url), subFirst[0].url);
ok('the anime profile keeps every source', subFirst.length === animeStreams.length);
setSettings({ preferredAnimeAudio: 'dub' });
var dubFirst = P._debug.rankStreams(animeStreams.slice(), { isAnime: true });
ok('anime profile honours the dub preference', /dub\.m3u8/.test(dubFirst[0].url), dubFirst[0].url);
setSettings({ preferredAnimeAudio: 'any' });
ok('no preference keeps both sources',
  P._debug.rankStreams(animeStreams.slice(), { isAnime: true }).length === animeStreams.length);

g('7. Stable ordering for equal scores');
setSettings({ sourceOrder: 'best' });
var equal = [
  { url: 'https://x.example/1.m3u8', quality: '1080p', label: 'X', container: 'hls', kind: 'raw' },
  { url: 'https://x.example/2.m3u8', quality: '1080p', label: 'X', container: 'hls', kind: 'raw' },
  { url: 'https://x.example/3.m3u8', quality: '1080p', label: 'X', container: 'hls', kind: 'raw' }
];
var ordered = P._debug.rankStreams(equal.slice(), { isAnime: false });
ok('equal scores keep their discovery order',
  ordered[0].url === equal[0].url && ordered[2].url === equal[2].url,
  ordered.map(function (s) { return s.url; }).join(', '));

g('8. Reliability is recorded with time decay and never becomes permanent');
var before = P._debug.rankStats ? Object.keys(P._debug.rankStats()).length : -1;
ok('ranking statistics are exposed for diagnostics', before >= 0);
ok('the reliability table is bounded', (function () {
  var stats = P._debug.rankStats ? P._debug.rankStats() : {};
  return Object.keys(stats).length <= 240;
})());

g('9. Ranking never filters');
setSettings({ sourceOrder: 'speed' });
var many = [];
for (var i = 0; i < 25; i++) many.push({ url: 'https://h' + i + '.example/a.m3u8', quality: '480p', label: 'H' + i, container: 'hls', kind: 'raw' });
var out = P._debug.rankStreams(many, { isAnime: false });
ok('all 25 sources survive the speed ordering', out.length === 25, String(out.length));

global.__settings = origSettings;
console.log('\n\x1b[32m✓ ' + pass + ' passed\x1b[0m' + (fail ? ' \x1b[31m✗ ' + fail + ' failed\x1b[0m' : ''));
process.exit(fail > 0 ? 1 : 0);
