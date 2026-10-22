const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const proxy = require('../scripts/uniquestream-proxy.cjs');

const mediaId = 'MEDIA001';
const realKey = Buffer.from('0123456789abcdef', 'ascii');
const wrapKey = crypto.createHash('sha256').update('key' + mediaId).digest().subarray(0, 16);
const wrapIv = crypto.createHash('sha256').update('iv' + mediaId).digest().subarray(0, 16);
const cipher = crypto.createCipheriv('aes-128-cbc', wrapKey, wrapIv);
const wrapped = Buffer.concat([cipher.update(realKey), cipher.final()]).toString('base64');
assert.deepEqual(proxy.decryptWrappedKey(wrapped, mediaId), realKey,
  'encrypted key.bin should decrypt to the original 16-byte HLS key');

const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",DEFAULT=YES,URI="audio/ja.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO="audio"',
  '720/playlist.m3u8',
  '#EXT-X-ENDLIST'
].join('\n');
const rewrittenMaster = proxy.rewritePlaylist(
  master, 'https://media.uniquestream.net/hls/master.m3u8', mediaId, 'http://127.0.0.1:8787'
);
assert.match(rewrittenMaster, /http:\/\/127\.0\.0\.1:8787\/playlist\.m3u8\?url=/,
  'master playlists must proxy variant playlists');
assert.match(rewrittenMaster, /TYPE=AUDIO[^\n]+URI="http:\/\/127\.0\.0\.1:8787\/playlist\.m3u8\?url=/,
  'alternate audio playlists must also pass through the proxy');

const media = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-MEDIA-SEQUENCE:7',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
  '#EXTINF:6.0,',
  'segments/0007.ts',
  '#EXTINF:6.0,',
  'segments/0008.ts',
  '#EXT-X-ENDLIST'
].join('\n');
const rewrittenMedia = proxy.rewritePlaylist(
  media, 'https://media.uniquestream.net/hls/episode/index.m3u8', mediaId, 'http://127.0.0.1:8787'
);
assert.doesNotMatch(rewrittenMedia, /#EXT-X-KEY/,
  'AES keys must be removed from the manifest because the proxy decrypts the segments');
assert.match(rewrittenMedia, /\/segment\?url=.*segments%2F0007\.ts.*seq=7.*key=.*keys%2Fkey\.bin/,
  'first segment URL must carry key URL and the media sequence IV');
assert.match(rewrittenMedia, /\/segment\?url=.*segments%2F0008\.ts.*seq=8/,
  'sequence number must advance for the next encrypted segment');
assert.deepEqual(proxy.normalizeIv('0x01', 0), Buffer.from('00000000000000000000000000000001', 'hex'));
assert.equal(proxy.isPublicIp('127.0.0.1'), false);
assert.equal(proxy.isPublicIp('10.1.2.3'), false);
assert.equal(proxy.isPublicIp('8.8.8.8'), true);

(async () => {
  await assert.rejects(proxy.validateHttpsUrl('http://example.com/video.m3u8'), /HTTPS/);
  await assert.rejects(proxy.validateHttpsUrl('https://127.0.0.1/private'), /Private upstream IP/);
  console.log('Uniquestream proxy tests passed (key decryption, HLS rewriting, IV sequence, and URL safety).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
