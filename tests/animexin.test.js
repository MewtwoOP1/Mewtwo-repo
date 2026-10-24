const assert = require('node:assert/strict');

const calls = [];
const baseSeries = 'https://animexin.dev/renegade-immortal/';
const episode1 = 'https://animexin.dev/renegade-immortal-episode-1-indonesia-english-sub/';
const episode2 = 'https://animexin.dev/renegade-immortal-episode-2-indonesia-english-sub/';
const episode3 = 'https://animexin.dev/renegade-immortal-episode-3-indonesia-english-sub/';
const episode4 = 'https://animexin.dev/renegade-immortal-episode-4-indonesia-english-sub/';
const encodedDailymotion = Buffer.from(
  '<iframe src="https://geo.dailymotion.com/player/xhojl.html?video=abc123"></iframe>'
).toString('base64');

const articleCard =
  '<article class="bsx">' +
    '<a href="' + episode2 + '">' +
      '<img src="https://img.example/renegade.jpg" alt="Renegade Immortal Episode 2">' +
    '</a>' +
    '<div class="tt"><a href="' + baseSeries + '">Renegade Immortal</a></div>' +
    '<h2 itemprop="headline">Renegade Immortal Episode 2 Indonesia, English Sub</h2>' +
    '<span class="epx">Ep 2</span><div class="typez">ONA</div>' +
  '</article>';

const cardHtml =
  '<div class="anime-card"><a href="' + baseSeries + '" title="Renegade Immortal">' +
  '<img class="poster" alt="Renegade Immortal Poster" data-src="https://img.example/renegade.jpg"></a></div>' +
  '<div><a href="' + episode2 + '">Episode 2</a></div>';
const movieCardHtml =
  '<div><a href="/renegade-immortal-movie-slaying-the-blood-progenitor/" title="Renegade Immortal Movie">' +
  '<img alt="Renegade Immortal Movie Poster" src="https://img.example/movie.jpg"></a></div>';
const homeHtml =
  '<h2>Popular Today</h2>' + cardHtml +
  '<h3>Latest Release</h3>' + cardHtml +
  '<h2>New Movie</h2>' + movieCardHtml;

const seriesHtml =
  '<h1 class="entry-title">Renegade Immortal</h1>' +
  '<div class="thumb"><img src="https://img.example/renegade.jpg" alt="Renegade Immortal"></div>' +
  '<div class="spe">' +
    '<span><b>Status:</b> Ongoing</span>' +
    '<span><b>Network:</b> <a href="/network/tencent/">Tencent Penguin Pictures</a></span>' +
    '<span><b>Studio:</b> <a href="/studio/build-dream/">Build Dream</a></span>' +
    '<span><b>Released:</b> Sep 25, 2023</span>' +
    '<span><b>Duration:</b> 25 Minute</span>' +
    '<span><b>Country:</b> <a href="/country/china/">China</a></span>' +
    '<span><b>Type:</b> ONA</span>' +
    '<span><b>Episodes:</b> 180</span>' +
    '<span><b>Fansub:</b> AnimeXin</span>' +
  '</div>' +
  '<div class="genxed"><a href="/genre/action/">Action</a><a href="/genre/fantasy/">Fantasy</a></div>' +
  '<div class="entry-content"><p>Wang Lin was a very intelligent child.</p><p>He struggles to become a true Immortal.</p></div>' +
  '<ul>' +
    '<li data-index="2"><a href="' + episode2 + '"><div class="epl-num">2</div><div class="epl-title">Episode 2 Subtitle Sub</div><div class="epl-date">Oct 2, 2026</div></a></li>' +
    '<li data-index="1"><a href="' + episode1 + '"><div class="epl-num">1</div><div class="epl-title">Episode 1 Subtitle Sub</div><div class="epl-date">Oct 1, 2026</div></a></li>' +
  '</ul>';

global.fetch = async function (url, options) {
  url = String(url); options = options || {};
  calls.push({ url, options });

  if (url === 'https://animexin.dev/') return { status: 200, body: homeHtml };
  if (url === 'https://animexin.dev/anime/?order=update&status=&type=') return { status: 200, body: articleCard };
  if (url === 'https://animexin.dev/page/2/?s=Renegade%20Immortal') return { status: 200, body: '' };
  if (url === 'https://animexin.dev/?s=Renegade%20Immortal') return { status: 200, body: articleCard };
  // Real AnimeXin search templates can render a title link without an image.
  if (url === 'https://animexin.dev/?s=Solo%20Leveling') return { status: 200, body:
    '<main class="search-results"><h2 class="entry-title"><a href="https://animexin.dev/solo-leveling/">Solo Leveling</a></h2></main>' };
  if (url === 'https://animexin.dev/?s=Fallback%20Series') return { status: 200, body: '<main>No results found</main>' };
  if (url === 'https://animexin.dev/anime/?s=Fallback%20Series') return { status: 200, body:
    '<article class="search-result"><h2><a href="https://animexin.dev/fallback-series/">Fallback Series</a></h2></article>' };
  if (url === 'https://animexin.dev/?s=offline') return { status: 503, body: 'unavailable' };
  if (url === baseSeries) return { status: 200, body: seriesHtml };

  if (url === episode1 || url === episode2) {
    return { status: 200, body: '<div class="nvs nvsc"><a href="' + baseSeries + '">Renegade Immortal</a></div>' +
      '<iframe src="https://odysee.com/$/embed/@public-channel:1/renegade-immortal-episode-1:5?signature=abc"></iframe>' };
  }
  if (url === episode3) {
    return { status: 200, body: '<iframe src="https://geo.dailymotion.com/player/xhojl.html?video=unavailable"></iframe>' };
  }
  if (url === episode4) {
    return { status: 200, body: '<select><option value="' + encodedDailymotion + '">Dailymotion</option></select>' };
  }

  if (url === 'https://api.na-backend.odysee.com/api/v1/proxy?m=get') {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).uri, 'lbry://@public-channel:1/renegade-immortal-episode-1:5');
    return { status: 200, body: JSON.stringify({
      data: { streaming_url: 'https://player.odycdn.com/api/v4/streams/free/ri-episode1/abcdef.mp4' }
    }) };
  }
  if (url === 'https://www.dailymotion.com/player/metadata/video/abc123') {
    return { status: 200, body: JSON.stringify({
      qualities: { auto: [{ url: 'https://cdn.example/ri-episode4.m3u8' }] }, duration: 1500
    }) };
  }
  if (url === 'https://www.dailymotion.com/player/metadata/video/unavailable') {
    return { status: 404, body: '{}' };
  }

  return { status: 404, body: '' };
};

const provider = require('../providers/animexin.js');

async function main() {
  assert.equal(provider.version, '1.0.2');
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(provider.getInfo(), {
    name: 'AnimeXin', lang: 'en', baseUrl: 'https://animexin.dev',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animexin.dev',
    type: 'anime', version: '1.0.2'
  });

  const home = await provider.getHome({});
  assert.equal(home.length, 3);
  assert.equal(home[0].title, 'Popular Today');
  assert.equal(home[0].items[0].id, 'renegade-immortal');
  assert.equal(home[1].title, 'Latest Release');
  assert.equal(home[2].title, 'Recently Updated');

  const results = await provider.search('Renegade Immortal', 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Renegade Immortal');
  assert.equal(results[0].url, baseSeries);
  assert.equal(results[0].cover, 'https://img.example/renegade.jpg');
  assert.equal(results[0].episode, 'Ep 2');

  // Headline-only results are parsed even without a poster and are normalized
  // to a usable series URL.
  const titleOnly = await provider.search('Solo Leveling', 1, {});
  assert.equal(titleOnly.length, 1);
  assert.equal(titleOnly[0].title, 'Solo Leveling');
  assert.equal(titleOnly[0].url, 'https://animexin.dev/solo-leveling/');

  // If the root search renders no results, the provider tries the anime archive.
  const archiveFallback = await provider.search('Fallback Series', 1, {});
  assert.equal(archiveFallback.length, 1);
  assert.equal(archiveFallback[0].title, 'Fallback Series');
  assert.ok(calls.some(c => c.url === 'https://animexin.dev/anime/?s=Fallback%20Series'));
  assert.deepEqual(await provider.search('', 1, {}), []);
  assert.deepEqual(await provider.search('Renegade Immortal', 2, {}), []);
  assert.deepEqual(await provider.search('offline', 1, {}), []);

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.id, 'renegade-immortal');
  assert.equal(detail.title, 'Renegade Immortal');
  assert.match(detail.description, /Wang Lin was a very intelligent child/);
  assert.equal(detail.cover, 'https://img.example/renegade.jpg');
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.year, 2023);
  assert.equal(detail.episodeCount, 180);
  assert.deepEqual(detail.genres, ['Action', 'Fantasy']);
  assert.deepEqual(detail.studios, ['Build Dream']);
  assert.equal(detail.network, 'Tencent Penguin Pictures');
  assert.equal(detail.country, 'China');
  assert.equal(detail.mediaType, 'ONA');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, 'Episode 1 Subtitle Sub');
  assert.equal(detail.episodes[1].number, 2);
  assert.equal((await provider.getEpisodes(results[0].url, {})).length, 2);

  // A detail request accidentally made with an episode URL should resolve to its parent series.
  const detailFromEpisode = await provider.getDetail(episode1, {});
  assert.equal(detailFromEpisode.id, 'renegade-immortal');
  assert.equal(detailFromEpisode.episodes.length, 2);

  const odysee = await provider.getVideoSources(episode1, {});
  assert.equal(odysee.length, 1);
  assert.equal(odysee[0].url, 'https://player.odycdn.com/api/v4/streams/free/ri-episode1/abcdef.mp4');
  assert.equal(odysee[0].container, 'mp4');

  const dailymotion = await provider.getVideoSources(episode4, {});
  assert.equal(dailymotion.length, 1);
  assert.equal(dailymotion[0].url, 'https://cdn.example/ri-episode4.m3u8');
  assert.equal(dailymotion[0].container, 'hls');

  assert.deepEqual(await provider.getVideoSources(episode3, {}), []);
  assert.deepEqual(await provider.getVideoSources('https://outside.example/watch/episode-1', {}), []);
  assert.ok(calls.some(c => c.url === 'https://www.dailymotion.com/player/metadata/video/abc123'));
  assert.ok(calls.some(c => c.url === 'https://api.na-backend.odysee.com/api/v1/proxy?m=get'));
  assert.ok(calls.every(c => c.options.headers && c.options.headers.Referer));
  console.log('AnimeXin mocked tests passed: native article cards, series metadata/episode association, encoded player selection, Odysee and Dailymotion HLS/MP4, subtitles-compatible schema and failure handling.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
