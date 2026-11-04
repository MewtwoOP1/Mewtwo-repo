'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  animeheaven: {
    requestTimeoutMs: '12000',
    maxStreams: '2'
  }
};

function card(slug, title, cover) {
  return '<div class="anime-card"><a href="/anime.php?' + slug + '" title="' + title + '">' +
    '<img src="' + (cover || '/img/default.jpg') + '" alt="' + title + '">' +
    '<div class="fastname">' + title + '</div></a></div>';
}
function html(value, status, headers) {
  return new Response(value, {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'text/html; charset=utf-8' }, headers || {})
  });
}

const detailHtml = '<html><head>' +
  '<meta property="og:title" content="Mock Anime">' +
  '<meta property="og:image" content="https://img.example/poster.jpg">' +
  '<meta name="description" content="A mock AnimeHeaven synopsis">' +
  '</head><body><div class="anime-title">Mock Anime</div>' +
  '<a href="/anime.php?mock" onmouseover="gateh(\'KEY1\')"><div class="watch2">1</div><span>Episode 1</span></a>' +
  '<a href="/anime.php?mock" onmouseover="gateh(\'KEY2\')"><div class="watch2">2</div><span>Episode 2</span></a>' +
  '</body></html>';

const gateHtml = '<html><body>' +
  '<video controls><source src="https://ax.animeheaven.me/video.mp4?token=a&amp;mirror=ax" type="video/mp4"></video>' +
  '<video controls><source src="https://rt.animeheaven.me/video.mp4?token=a&amp;mirror=rt" type="video/mp4"></video>' +
  '<video controls><source src="https://ck.animeheaven.me/video.mp4?token=a&amp;mirror=ck" type="video/mp4"></video>' +
  '<video controls><source src="https://ax.animeheaven.me/video.mp4?token=a&amp;mirror=ax" type="video/mp4"></video>' +
  '<video controls><source src="https://ct.animeheaven.me/video.mp4?token=a&amp;error" type="video/mp4"></video>' +
  '<video controls><source src="https://ck.animeheaven.me/video.mp4?token=a&amp;error2" type="video/mp4"></video>' +
  '</body></html>';

const requests = [];
let sessionCookieSent = false;
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  const cookie = String((options.headers || {}).Cookie || '');
  if (/gate\.php/.test(target)) {
    sessionCookieSent = /heaven_session=abc/.test(cookie) && /key=KEY1/.test(cookie);
    assert.match(String((options.headers || {}).Referer || ''), /anime\.php\?mock/);
    return html(gateHtml);
  }
  if (target === 'https://animeheaven.me/fastsearch.php?xhr=1&s=Mock%20Anime') {
    return html(card('mock', 'Mock Anime'), 200, { 'set-cookie': 'heaven_session=abc; Path=/; HttpOnly' });
  }
  if (target === 'https://animeheaven.me/fastsearch.php?xhr=1&s=Fallback%20Show') return html('<html></html>');
  if (target === 'https://animeheaven.me/anime.php?mock') return html(detailHtml);
  if (target === 'https://animeheaven.me/new.php') return html(card('new-one', 'Fallback Show'));
  if (target === 'https://animeheaven.me/popular.php') return html(card('popular-one', 'Popular One'));
  if (target === 'https://animeheaven.me/') return html(card('featured-one', 'Featured One'));
  return html('not found', 404);
};

const provider = require('../providers/animeheaven.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'animeheaven');

async function main() {
  assert.ok(source, 'AnimeHeaven must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((entry) => entry.key), source.settings.map((entry) => entry.key));

  const cards = provider._cards(card('direct', 'Direct Card'));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Direct Card');
  assert.equal(cards[0].sourceId, 'animeheaven');

  const home = await provider.getHome({});
  assert.equal(home.length, 3);
  assert.deepEqual(home.map((row) => row.title), ['New Episodes', 'Popular Today', 'Featured']);
  assert.ok(home.every((row) => row.items.length === 1));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].title, 'Mock Anime');
  assert.equal(search[0].url, 'https://animeheaven.me/anime.php?mock');
  assert.equal(sessionCookieSent, false, 'the gate is not called yet');

  const detail = await provider.getDetail(search[0].url, {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.cover, 'https://img.example/poster.jpg');
  assert.equal(detail.description, 'A mock AnimeHeaven synopsis');
  assert.equal(detail.episodes.length, 2);
  assert.ok(detail.episodes.every((entry) => entry.category === 'sub'));
  assert.equal(detail.episodes[0].number, 1);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 2, 'the two error mirrors are filtered and the maxStreams setting applies');
  assert.equal(streams[0].url, 'https://ax.animeheaven.me/video.mp4?token=a&mirror=ax');
  assert.equal(streams[0].container, 'mp4');
  assert.equal(streams[0].kind, 'sub');
  assert.equal(streams[0].headers.Referer, 'https://animeheaven.me/gate.php');
  assert.equal(streams[1].url, 'https://rt.animeheaven.me/video.mp4?token=a&mirror=rt');
  assert.ok(streams.every((entry) => !/[?&]error2?(?:[=&#]|$)/i.test(entry.url)));
  assert.equal(sessionCookieSent, true, 'the session cookie and episode key reach gate.php');

  global.__settings.animeheaven.maxStreams = '4';
  const allStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(allStreams.length, 3, 'the third healthy mirror is returned after the limit is raised');
  global.__settings.animeheaven.maxStreams = '2';

  const fallback = await provider.search('Fallback Show', 1, {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].title, 'Fallback Show');

  assert.deepEqual(await provider.search('', 1, {}), []);
  assert.equal(await provider.getDetail('https://example.com/not-an-anime'), null);
  assert.deepEqual(await provider.getVideoSources('not-animeheaven://episode'), []);
  assert.equal(provider._episodePayload('animeheaven://%7B%22key%22%3A%22k%22%7D'), null);
  assert.deepEqual(provider._mediaSources('<video src="https://ax.animeheaven.me/v.mp4?x=1&error"></video>'), []);
  assert.deepEqual(provider._mediaSources('<video src="http://ax.animeheaven.me/v.mp4"></video>'), [], 'cleartext sources are rejected');
  assert.equal(provider._mediaSources('<video src="https://ax.animeheaven.me/v.mp4?x=1"></video>').length, 1);

  assert.ok(requests.some((entry) => entry.url === 'https://animeheaven.me/fastsearch.php?xhr=1&s=Mock%20Anime'));
  assert.ok(requests.some((entry) => entry.url === 'https://animeheaven.me/gate.php'));

  console.log('AnimeHeaven tests passed: manifest parity, real Response handling, cookie session, home/search/detail, episode gates, mirror filtering/deduplication, maxStreams, SUB metadata, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
