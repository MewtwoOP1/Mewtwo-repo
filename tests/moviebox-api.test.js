'use strict';
const assert = require('node:assert/strict');
const calls = [];
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  const body = {
    '/search?q=Avatar&page=1&per_page=20': {query:'Avatar',page:1,results:[
      {subject_id:'12345',title:'Avatar',type:'Movie',release_date:'2009-12-18',cover:'https://img.example/avatar.jpg',detail_path:'avatar-123'}
    ]},
    '/detail/12345': {subject_id:'12345',title:'Avatar',type:'Movie',description:'On Pandora',release_date:'2009-12-18',cover:'https://img.example/avatar.jpg',detail_path:'avatar-123'},
    '/episodes/12345': {subject_id:'12345',seasons:[]},
    '/api/stream/12345?se=0&ep=0&detail_path=avatar-123': {subject_id:'12345',season:0,episode:0,streams:[
      {source:'Web CDN',format:'MP4',quality:'1080p',url:'https://cdn.example/avatar.mp4',headers:{Referer:'https://moviebox.ph/'}}
    ]},
    '/api/stream/12345/captions?se=0&ep=0': {subject_id:'12345',captions:[{url:'https://sub.example/avatar.srt',lang_name:'English',format:'srt'}]}
  };
  const base = 'https://moviebox-api-lovat-nu.vercel.app';
  const path = url.startsWith(base) ? url.slice(base.length) : '';
  if (Object.prototype.hasOwnProperty.call(body, path)) return {status:200,body:JSON.stringify(body[path])};
  return {status:404,body:'{}'};
};
const provider = require('../providers/moviebox-api.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'MovieBox API');
  const results = await provider.search('Avatar', 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '12345');
  assert.equal(results[0].type, 'movie');
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, 'Avatar');
  const streams = await provider.getVideoSources(results[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/avatar.mp4');
  assert.equal(streams[0].container, 'mp4');
  assert.equal(streams[0].subtitles[0].lang, 'English');
  assert.ok(calls.some(c => c.url.indexOf('/api/stream/12345?se=0&ep=0&detail_path=avatar-123') >= 0));
  console.log('MovieBox API mocked integration tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
