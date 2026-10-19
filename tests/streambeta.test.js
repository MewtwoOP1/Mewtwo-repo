const assert = require("node:assert/strict");
const calls = [];
const html = '<title>Naruto Hindi Dubbed</title><script>var maskedFileId = "sb_hi123"; var currentLangNative = "Hindi"; var playerSources = [{"name":"fsl","type":"fsl","stream_url":"https://worker.example/video.mkv"},{"name":"10gbps","type":"10gbps","url":"https://worker2.example/video.mkv"},{"name":"bad","type":"pixeldrain","url":"https://pixeldrain.example/file"}];</script><div id="file-size-text">1.4 GB</div><button class="lang-btn active" data-fid="sb_hi123" data-lang="Hindi"></button><button class="lang-btn" data-fid="sb_ta456" data-lang="Tamil"></button>';
global.fetch = async function (url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === 'https://codedew.com/streambeta/?url=abcd1234') return {status:200,body:html};
  if (url === 'https://codedew.com/streambeta/?v=sb_hi123') return {status:200,body:html};
  if (url === 'https://codedew.com/streambeta/?v=sb_ta456') return {status:200,body:html.replace('currentLangNative = "Hindi"','currentLangNative = "Tamil"').replace('maskedFileId = "sb_hi123"','maskedFileId = "sb_ta456"')};
  return {status:404,body:''};
};
const provider = require('../providers/streambeta.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'StreamBeta Resolver');
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(await provider.search(''), []);
  const found = await provider.search('abcd1234');
  assert.equal(found.length, 1);
  assert.equal(found[0].url, 'streambeta://url/abcd1234');
  const detail = await provider.getDetail(found[0].url);
  assert.equal(detail.title, 'Naruto Hindi Dubbed');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].title, 'Hindi');
  assert.equal(detail.episodes[1].title, 'Tamil');
  const streams = await provider.getVideoSources('streambeta://v/sb_hi123');
  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, 'https://worker.example/video.mkv');
  assert.equal(streams[0].container, 'mp4');
  assert.ok(calls.some(x => x.url === 'https://codedew.com/streambeta/?url=abcd1234'));
  console.log('StreamBeta URL parsing, source extraction, alternate audio, and invalid-host checks passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
