const assert = require('node:assert/strict');

const calls = [];
const seriesHtml =
  '<meta property="og:image" content="https://img.example/renegade.jpg">' +
  '<meta name="description" content="A cultivator travels beyond mortal limits.">' +
  '<h1>Renegade Immortal</h1>' +
  '<div>Status: Ongoing Released: Sep 25, 2023 Country: China Type: ONA Episodes: 180</div>' +
  '<a href="https://animexin.dev/genre/action/">Action</a><a href="/genre/fantasy/">Fantasy</a>' +
  '<ul>' +
  '<li><a href="https://animexin.dev/renegade-immortal-episode-2-subtitle-sub-october-2-2026/" title="Renegade Immortal Episode 2 Subtitle Sub">Episode 2</a></li>' +
  '<li><a href="/renegade-immortal-episode-1-subtitle-sub-october-1-2026/" title="Renegade Immortal Episode 1 Subtitle Sub">Episode 1</a></li>' +
  '<li><a href="/other-series-episode-1-subtitle-sub/">Unrelated episode</a></li>' +
  '</ul>';
const cardHtml =
  '<div class="anime-card"><a href="/renegade-immortal/" title="Renegade Immortal"><img class="poster" alt="Renegade Immortal Poster" data-src="https://img.example/renegade.jpg"></a></div>' +
  '<div><a href="/renegade-immortal-episode-2-subtitle-sub-october-2-2026/">Episode 2</a></div>';
const movieCardHtml = '<div><a href="/renegade-immortal-movie-slaying-the-blood-progenitor/" title="Renegade Immortal Movie: Slaying the Blood Progenitor"><img alt="Renegade Immortal Movie Poster" src="https://img.example/movie.jpg"></a></div>';
const homeHtml = '<h2>Popular Today</h2>' + cardHtml + '<h3>Latest Release</h3>' + cardHtml + '<h2>New Movie</h2>' + movieCardHtml;

global.fetch = async function (url, options) {
  url = String(url); options = options || {};
  calls.push({ url, options });
  if (url === 'https://animexin.dev/') return { status: 200, body: homeHtml };
  if (url === 'https://animexin.dev/anime/?order=update&status=&type=') return { status: 200, body: cardHtml };
  if (url === 'https://animexin.dev/?s=Renegade%20Immortal&paged=1') return { status: 200, body: cardHtml };
  if (url === 'https://animexin.dev/?s=Renegade%20Immortal&paged=2') return { status: 200, body: '' };
  if (url === 'https://animexin.dev/renegade-immortal/') return { status: 200, body: seriesHtml };
  if (url === 'https://animexin.dev/renegade-immortal-episode-1-subtitle-sub-october-1-2026/') {
    return { status: 200, body: '<iframe src="https://odysee.com/$/embed/@public-channel:1/renegade-immortal-episode-1:5?signature=abc"></iframe>' };
  }
  if (url === 'https://animexin.dev/renegade-immortal-episode-2-subtitle-sub-october-2-2026/') {
    return { status: 200, body: '<iframe src="https://player.example/embed/episode2"></iframe>' };
  }
  if (url === 'https://animexin.dev/renegade-immortal-episode-3-indonesia-english-sub/') {
    return { status: 200, body: '<iframe src="https://geo.dailymotion.com/player/xhojl.html?video=unavailable"></iframe>' };
  }
  if (url === 'https://geo.dailymotion.com/player/xhojl.html?video=unavailable') {
    return { status: 200, body: '<html><body>Video cannot be played.</body></html>' };
  }
  if (url === 'https://api.na-backend.odysee.com/api/v1/proxy?m=get') {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).uri, 'lbry://@public-channel:1/renegade-immortal-episode-1:5');
    return { status: 200, body: JSON.stringify({ data: { streaming_url: 'https://player.odycdn.com/api/v4/streams/free/ri-episode1/abcdef.mp4' } }) };
  }
  if (url === 'https://player.example/embed/episode2') {
    return { status: 200, body: '<video><source type="application/x-mpegURL" src="https://cdn.example/ri-episode2.m3u8"></video><track kind="captions" src="https://cdn.example/ri-en.vtt" label="English" srclang="en" default>' };
  }
  if (url === 'https://animexin.dev/?s=offline&paged=1') return { status: 503, body: 'unavailable' };
  return { status: 404, body: '' };
};

const provider = require('../providers/animexin.js');

async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(provider.getInfo(), {
    name: 'AnimeXin', lang: 'en', baseUrl: 'https://animexin.dev',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animexin.dev',
    type: 'anime', version: '1.0.0'
  });

  const home = await provider.getHome({});
  assert.equal(home.length, 3);
  assert.equal(home[0].title, 'Popular Today');
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].id, 'renegade-immortal');
  assert.equal(home[0].items[0].cover, 'https://img.example/renegade.jpg');
  assert.equal(home[1].title, 'Latest Release');
  assert.equal(home[1].items.length, 1);
  assert.equal(home[2].title, 'Recently Updated');

  const results = await provider.search('Renegade Immortal', 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Renegade Immortal');
  assert.equal(results[0].url, 'https://animexin.dev/renegade-immortal/');
  assert.deepEqual(await provider.search('', 1, {}), []);
  assert.deepEqual(await provider.search('Renegade Immortal', 2, {}), []);
  assert.deepEqual(await provider.search('offline', 1, {}), []);

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.id, 'renegade-immortal');
  assert.equal(detail.title, 'Renegade Immortal');
  assert.equal(detail.description, 'A cultivator travels beyond mortal limits.');
  assert.equal(detail.cover, 'https://img.example/renegade.jpg');
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.year, 2023);
  assert.equal(detail.episodeCount, 180);
  assert.deepEqual(detail.genres, ['Action', 'Fantasy']);
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.match(detail.episodes[0].url, /renegade-immortal-episode-1/);
  assert.equal((await provider.getEpisodes(results[0].url, {})).length, 2);

  const odysee = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(odysee.length, 1);
  assert.equal(odysee[0].url, 'https://player.odycdn.com/api/v4/streams/free/ri-episode1/abcdef.mp4');
  assert.equal(odysee[0].container, 'mp4');
  assert.equal(odysee[0].headers.Referer, 'https://odysee.com/$/embed/@public-channel:1/renegade-immortal-episode-1:5?signature=abc');

  const embedded = await provider.getStreams(detail.episodes[1].url, {});
  assert.equal(embedded.length, 1);
  assert.equal(embedded[0].url, 'https://cdn.example/ri-episode2.m3u8');
  assert.equal(embedded[0].container, 'hls');
  assert.equal(embedded[0].subtitles.length, 1);
  assert.equal(embedded[0].subtitles[0].label, 'English');
  assert.equal(embedded[0].subtitles[0].lang, 'en');

  assert.deepEqual(await provider.getVideoSources('https://animexin.dev/renegade-immortal-episode-3-indonesia-english-sub/', {}), []);
  assert.deepEqual(await provider.getVideoSources('https://outside.example/watch/episode-1', {}), []);
  assert.ok(calls.some(c => c.url.includes('geo.dailymotion.com/player/xhojl.html?video=unavailable')));
  assert.ok(calls.some(c => c.options.headers && c.options.headers.Referer));
  console.log('AnimeXin mocked tests passed: manifest-facing API, home, search/pagination, detail, episodes, Odysee public resolution, direct HLS, subtitles, unavailable Dailymotion and failures.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
