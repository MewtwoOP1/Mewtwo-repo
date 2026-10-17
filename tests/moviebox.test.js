const assert = require('node:assert/strict');
const calls = [];
global.fetch = async (url, opts) => {
  url = String(url); calls.push({url, opts});
  if (url.includes('/trending/movie/week')) return {status:200, body:JSON.stringify({results:[{id:12,title:'Test Movie',release_date:'2024-01-01',poster_path:'/p.jpg'}]})};
  if (url.includes('/trending/tv/week')) return {status:200, body:JSON.stringify({results:[{id:34,name:'Test Show',first_air_date:'2023-01-01'}]})};
  if (url.includes('/movie/popular')) return {status:200, body:JSON.stringify({results:[]})};
  if (url.includes('/search/multi')) return {status:200, body:JSON.stringify({results:[{id:12,title:'Test Movie',media_type:'movie'}]})};
  if (url.includes('/movie/12?append_to_response')) return {status:200, body:JSON.stringify({id:12,title:'Test Movie',release_date:'2024-01-01',overview:'A test',genres:[{name:'Drama'}],poster_path:'/p.jpg',external_ids:{imdb_id:'tt123'}})};
  if (url.includes('/tv/34?append_to_response')) return {status:200, body:JSON.stringify({id:34,name:'Test Show',first_air_date:'2023-01-01',seasons:[{season_number:1}],external_ids:{imdb_id:'tt456'}})};
  if (url.includes('/tv/34/season/1')) return {status:200, body:JSON.stringify({episodes:[{episode_number:1,name:'Pilot'}]})};
  if (url.includes('/streams?')) return {status:200, body:JSON.stringify({streams:[{name:'MovieBox (Hindi)',proxy_url:'https://worker.example/video.mp4',resolution:'1080',codec:'h264'},{name:'no url'}]})};
  return {status:404, body:'{}'};
};
const p = require('../providers/moviebox.js');
async function main() {
  assert.equal(p.version, '1.0.0');
  assert.equal(p.getInfo().name, 'MovieBox');
  assert.deepEqual(p.getSettings(), []);
  const home = await p.getHome();
  assert.equal(home.length, 2);
  assert.equal(home[0].items[0].url, 'moviebox://movie/12');
  const results = await p.search('Test Movie', 1);
  assert.equal(results.length, 1);
  const detail = await p.getDetail('moviebox://movie/12');
  assert.equal(detail.episodes[0].url, 'moviebox://movie/12');
  const tv = await p.getDetail('moviebox://tv/34');
  assert.equal(tv.episodes.length, 1);
  assert.equal(tv.episodes[0].url, 'moviebox://tv/34/1/1');
  const streams = await p.getVideoSources('moviebox://tv/34/1/1');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://worker.example/video.mp4');
  assert.equal(streams[0].quality, '1080p');
  assert.ok(calls.some(c => c.url.includes('/streams?tmdb_id=34&type=tv')));
  assert.deepEqual(await p.getVideoSources('moviebox://tv/34'), []);
  console.log('MovieBox mocked catalogue, TMDB episode mapping, stream parsing and invalid episode tests passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
