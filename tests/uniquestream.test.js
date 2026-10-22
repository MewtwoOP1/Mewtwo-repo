const assert = require('node:assert/strict');
const provider = require('../providers/uniquestream.js');
const oldFetch = global.fetch;
const calls = [];
const seriesUrl = 'https://anime.uniquestream.net/series/AG689vQw/Attack-on-Titan/';
const seriesHtml = `
<html><head>
<title>Watch Attack on Titan | AnimeStream</title>
<meta name="description" content="Humanity fights the Titans.">
<meta property="og:image" content="https://media.uniquestream.net/posters/aot.jpg">
<meta name="datePublished" content="2013-04-07">
</head><body>
<nav><ul><li><a href="/about">About</a></li></ul></nav>
<main><h1>Attack on Titan</h1>
<p>STUDIO <span>MAPPA</span></p>
<p>Episodes <strong>100</strong></p><p>Seasons <strong>6</strong></p>
<a href="/genre/action">Action</a><a href="/genre/fantasy">Fantasy</a>
<p class="programme-notes">Humanity fights the Titans.</p>
<a href="/watch/ep001/Attack-on-Titan-Episode-1">Episode 1</a>
<a href="/watch/ep002/Attack-on-Titan-Episode-2">Episode 2</a>
<a href="/watch/shortcut/Attack-on-Titan" aria-label="Start Watching S1 E1">Start Watching S1 E1</a>
</main></body></html>`;
const searchHtml = `
<html><body><nav><ul><li><a href="/about">About</a></li></ul></nav>
<div class="catalog-card"><a href="/series/AG689vQw/Attack-on-Titan"><h2>Attack on Titan</h2><img data-src="https://media.uniquestream.net/posters/aot.jpg"></a></div>
<div class="catalog-card"><a href="/series/XYZ123/Another-Show"><h2>Another Show</h2></a></div>
</body></html>`;
global.fetch = async (url, opts) => {
  const u = String(url); calls.push({url:u,opts:opts||{}});
  if (u.includes('/search?q=Attack%20on%20Titan')) return {status:200,body:searchHtml};
  if (u.includes('/search?q=missing')) return {status:200,body:'<main>No titles</main>'};
  if (u.includes('/search?q=malformed')) return {status:200,body:'<html><div'};
  if (u.includes('/search?q=fallback')) return {status:503,body:'busy'};
  if (u.includes('/series/AG689vQw/Attack-on-Titan')) return {status:200,body:seriesHtml};
  if (u.includes('/series/XYZ123/Another-Show')) return {status:200,body:'<h1>Another Show</h1>'};
  if (u.includes('/watch/ep001/')) return {status:200,body:'<video><source src="https://media.uniquestream.net/video/episode1.m3u8"></video>'};
  if (u.includes('/watch/ep002/')) return {status:200,body:'<main>Playback not available</main>'};
  if (u.includes('/watch/ep003/')) return {status:200,body:'<script>window.player={"file":"https://cdn.example.net/video/episode3.mp4"};</script>'};
  if (u.includes('/videos/popular/')) return {status:200,body:searchHtml};
  if (u.includes('/watch/err/')) throw new Error('network down');
  return {status:404,body:'not found'};
};
async function main() {
  assert.equal(provider.version,'0.2.0');
  assert.equal(provider.getInfo().name,'Uniquestream');
  assert.deepEqual(await provider.search(''),[]);
  const results=await provider.search('Attack on Titan');
  assert.equal(results.length,2,'catalogue cards inside divs must be found even when nav lists exist');
  assert.equal(results[0].title,'Attack on Titan');
  assert.equal(results[0].cover,'https://media.uniquestream.net/posters/aot.jpg');
  assert.deepEqual(await provider.search('missing'),[]);
  assert.deepEqual(await provider.search('malformed'),[]);
  assert.deepEqual(await provider.search('fallback'),[]);
  assert.deepEqual(await provider.search('network error'),[]);
  const detail=await provider.getDetail(results[0].url);
  assert.equal(detail.title,'Attack on Titan');
  assert.equal(detail.description,'Humanity fights the Titans.');
  assert.equal(detail.cover,'https://media.uniquestream.net/posters/aot.jpg');
  assert.equal(detail.year,2013);
  assert.equal(detail.episodeCount,100);
  assert.equal(detail.seasons,6);
  assert.deepEqual(detail.genres,['Action','Fantasy']);
  assert.equal(detail.episodes.length,2,'shortcut link should not be treated as an episode');
  assert.equal(detail.episodes[1].number,2);
  assert.equal((await provider.getEpisodes(results[0].url)).length,2);
  const streams=await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length,1);
  assert.equal(streams[0].url,'https://media.uniquestream.net/video/episode1.m3u8');
  await assert.rejects(provider.getVideoSources('invalid'),/invalid episode URL/);
  await assert.rejects(provider.getVideoSources(detail.episodes[1].url),/did not expose|did not expose|did not expose|did not expose|direct HTTPS media URL/);
  const third='uniquestream://episode/'+encodeURIComponent('https://anime.uniquestream.net/watch/ep003/Attack-on-Titan-Episode-3');
  assert.equal((await provider.getVideoSources(third))[0].url,'https://cdn.example.net/video/episode3.mp4');
  await assert.rejects(provider.getVideoSources('uniquestream://episode/'+encodeURIComponent('https://evil.example/watch/aa')),/invalid watch page/);
  const backup='https://media.uniquestream.net/video/fallback.mp4';
  global.fetch=async (url)=>({status:200,body:String(url).includes('/watch/')?'<script type="application/ld+json">'+JSON.stringify({contentUrl:backup})+'</script>':'<html></html>'});
  const fallback=await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(fallback[0].url,backup);
  await assert.rejects(provider.getVideoSources('uniquestream://episode/%E0%A4%A'),/malformed episode/);
  global.fetch=async()=>{throw new Error('offline');};
  assert.deepEqual(await provider.search('failure'),[]);
  await assert.rejects(provider.getVideoSources(detail.episodes[0].url),/offline/);
  global.fetch=async()=>({status:200,body:'<video src="http://evil.example/video.m3u8"></video>'});
  await assert.rejects(provider.getVideoSources(detail.episodes[0].url),/direct HTTPS media URL/);
  console.log('Uniquestream mocked tests passed ('+calls.length+' recorded initial requests).');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.fetch=oldFetch;});
