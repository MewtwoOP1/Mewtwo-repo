const assert = require('node:assert/strict');

const calls = [];
const home = '<html><body>' +
  '<article class="post"><a href="https://animesalt.cx/series/naruto/"><h2 class="entry-title">Naruto</h2><img src="https://img.example/naruto.jpg" alt="Naruto"></a></article>' +
  '<article class="post"><a href="https://animesalt.cx/movies/naruto-movie/"><h2 class="entry-title">Naruto Movie</h2></a></article>' +
  '<a href="/series/">Series</a><a href="/movies/">Movies</a>' + 'x'.repeat(1200) + '</body></html>';
const detail = '<html><head><meta property="og:image" content="https://img.example/naruto-cover.jpg">' +
  '<meta property="og:description" content="A ninja story"></head><body><h1>Naruto</h1>' +
  '<div data-post="42"></div><button data-season="1">Season 1</button><button data-season="2">Season 2</button>' +
  '<a href="https://animesalt.cx/episode/naruto-1x1/">Episode 1</a></body></html>';
const callsFor = (url) => calls.filter((c) => c.url === url);

global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });
  if (url === 'https://animesalt.cx/' || url === 'https://animesalt.cx/series/' || url === 'https://animesalt.cx/movies/') return { status: 200, body: home };
  if (url === 'https://animesalt.cx/?s=naruto') return { status: 200, body: home };
  if (url === 'https://animesalt.cx/page/2/?s=naruto') return { status: 200, body: home };
  if (url === 'https://animesalt.cx/series/naruto/') return { status: 200, body: detail };
  if (url === 'https://animesalt.cx/movies/naruto-movie/') return { status: 200, body: '<h1>Naruto Movie</h1>' };
  if (url === 'https://animesalt.cx/wp-admin/admin-ajax.php') {
    assert.equal(options.method, 'POST');
    assert.match(options.body, /action=action_select_season/);
    return { status: 200, body: '<a href="https://animesalt.cx/episode/naruto-1x2/">Episode 2</a>' };
  }
  if (url === 'https://animesalt.cx/episode/naruto-1x1/') return { status: 200, body: '<iframe src="https://as-cdn1.top/video/abcdef123"></iframe>' };
  if (url === 'https://as-cdn1.top/player/index.php?data=abcdef123&do=getVideo') {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Referer, 'https://as-cdn1.top/video/abcdef123');
    return { status: 200, body: JSON.stringify({ videoSource: 'https://cdn.example/master.m3u8?token=abc' }) };
  }
  if (url === 'https://cdn.example/master.m3u8?token=abc') return { status: 200, body: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi"\n#EXTINF:5,\nsegment.ts' };
  if (url === 'https://animesalt.cx/episode/broken-1x1/') return { status: 200, body: '<html>No player here</html>' };
  return { status: 404, body: '' };
};

const provider = require('../providers/animesalt.js');

async function main() {
  assert.equal(provider.version, '1.0.1');
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(provider.getInfo(), {
    name: 'AnimeSalt', lang: 'hi', baseUrl: 'https://animesalt.cx',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animesalt.cx',
    type: 'anime', version: '1.0.1'
  });

  const found = await provider.search('naruto', 1, {});
  assert.equal(found.length, 2);
  assert.equal(found[0].title, 'Naruto');
  assert.equal(found[0].url, 'https://animesalt.cx/series/naruto/');
  assert.equal(found[0].cover, 'https://img.example/naruto.jpg');

  const page2 = await provider.search('naruto', 2, {});
  assert.equal(page2.length, 2);
  assert.ok(calls.some((c) => c.url === 'https://animesalt.cx/page/2/?s=naruto'));

  const sections = await provider.getHome({});
  assert.ok(sections.length > 0);
  assert.ok(sections.every((section) => Array.isArray(section.items)));

  const data = await provider.getDetail(found[0].url, { category: 'dub' });
  assert.equal(data.title, 'Naruto');
  assert.equal(data.cover, 'https://img.example/naruto-cover.jpg');
  assert.equal(data.episodes.length, 2);
  assert.deepEqual(data.episodes.map((e) => e.title), ['S1 E1', 'S1 E2']);
  assert.ok(data.episodes.every((e) => e.url.startsWith('animesalt://dub|')));
  const episodesBefore = callsFor('https://animesalt.cx/series/naruto/').length;
  assert.equal((await provider.getEpisodes(found[0].url, {})).length, 2);
  assert.equal(callsFor('https://animesalt.cx/series/naruto/').length, episodesBefore + 1);

  const sources = await provider.getVideoSources(data.episodes[0].url, {});
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://cdn.example/master.m3u8?token=abc');
  assert.equal(sources[0].container, 'hls');
  assert.equal(sources[0].kind, 'dub');
  assert.equal(sources[0].audioLang, 'multi');
  assert.equal(sources[0].label, 'AnimeSalt · Multi-audio');
  assert.equal(sources[0].headers.Referer, 'https://as-cdn1.top/');
  const playlist = await global.fetch(sources[0].url, { headers: sources[0].headers });
  assert.match(playlist.body, /^#EXTM3U/);
  assert.match(playlist.body, /TYPE=AUDIO/);

  await assert.rejects(() => provider.getVideoSources('animesalt://sub|https%3A%2F%2Fanimesalt.cx%2Fepisode%2Fbroken-1x1%2F'), /no as-cdn player/);
  await assert.rejects(() => provider.getVideoSources('https://example.com/anything'), /invalid episode URL/);
  console.log('AnimeSalt manifest contract, search, home, season/episode parsing, multi-audio HLS and invalid-input tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
