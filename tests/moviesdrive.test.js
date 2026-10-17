const assert = require('node:assert/strict');
const calls=[];
global.fetch=async function(url,opts){
  url=String(url); calls.push({url,opts:opts||{}});
  if(url.includes('domains.json')) return {status:200,body:JSON.stringify({moviesdrive:'https://new4.moviesdrive.christmas'})};
  if(url.includes('/search.php?q=Test')) return {status:200,body:JSON.stringify({hits:[{document:{post_title:'Test Movie 2024',permalink:'/test-movie-2024/',post_thumbnail:'/poster.jpg'}}]})};
  if(url.endsWith('/test-movie-2024/')) return {status:200,body:'<h1 class="post-title">Movie</h1><div class="poster-title">Test Movie 2024</div><h5><a href="https://hubcloud.example/drive/abc">Download</a></h5><meta property="og:image" content="/poster.jpg">'}; 
  if(url==='https://hubcloud.example/drive/abc') return {status:200,body:'<div class="card-header">Test Movie 1080p WEB-DL</div><a href="https://cdn.example/video.mp4">Download File</a>'};
  if(url.includes('/trending') || url.includes('/search/multi')) return {status:200,body:JSON.stringify({results:[]})};
  return {status:200,body:'<a href="https://hubcloud.example/drive/abc">HubCloud</a>'};
};
const p=require('../providers/moviesdrive.js');
async function main(){
 assert.equal(p.getInfo().name,'MoviesDrive');
 const results=await p.search('Test Movie',1); assert.equal(results.length,1); assert.ok(results[0].url.includes('/test-movie-2024/'));
 const detail=await p.getDetail('https://new4.moviesdrive.christmas/test-movie-2024/'); assert.equal(detail.episodes.length,1);
 const streams=await p.getVideoSources(detail.episodes[0].url); assert.equal(streams.length,1); assert.equal(streams[0].url,'https://cdn.example/video.mp4'); assert.equal(streams[0].quality,'1080p');
 assert.ok(calls.some(c=>c.url.includes('search.php?q=Test%20Movie')));
 console.log('MoviesDrive mocked search, detail, HubCloud resolution and playable URL tests passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
