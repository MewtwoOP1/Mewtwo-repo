// internetarchive.js — Public domain movies & TV from Internet Archive.
//
// Provides free, legal access to public domain films and television shows
// hosted on archive.org. No authentication required. All streams are direct
// MP4/HLS URLs served from archive.org's CDN.
//
// This is an independent provider with its own search, metadata, and stream
// extraction logic. It does not depend on VAPlayer or any other resolver.
//
// Licensed under MIT (same as the rest of this repository).
//
// Source: https://archive.org
// API docs: https://archive.org/advancedsearch.php

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'internetarchive';
var VERSION = '1.0.1';
var IA_SEARCH = 'https://archive.org/advancedsearch.php';
var IA_METADATA = 'https://archive.org/metadata';
var IA_DOWNLOAD = 'https://archive.org/download';
var IA_PAGE = 'https://archive.org/details';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// ── Utilities ──────────────────────────────────────────────────────────────

function _get(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'User-Agent': UA, 'Accept': 'application/json' }, opts.headers || {});
  return fetch(url, opts).then(function (r) { return r.text(); }).then(function (t) {
    try { return JSON.parse(t); } catch (e) { return t; }
  });
}

function _q(s) { return encodeURIComponent(String(s || '')); }

// ── Media file selection ─────────────────────────────────────────────────

// Collect all playable video files from an Internet Archive file listing.
// Returns them sorted by size descending (best quality first).
function _pickVideoFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(function (f) {
    var n = String(f.name || '').toLowerCase();
    return /\.(mp4|m4v|mkv|webm|mov)(\?|$)/i.test(n);
  }).sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
}

// Pick the single best playable video file (for detail view).
function _pickBestVideoFile(files) {
  var list = _pickVideoFiles(files);
  return list.length > 0 ? list[0] : null;
}

// ── Settings ─────────────────────────────────────────────────────────────

function getHome() {
  return [
    { id: 'nosferatu-2024-720p-blu-ray-extended-cut-blu-ray-2', title: 'Nosferatu (2024)', year: '2024', type: 'movie', mediatype: 'movies' },
    { id: 'metropolis-1927', title: 'Metropolis (1927)', year: '1927', type: 'movie', mediatype: 'movies' },
    { id: 'night-of-the-living-dead-1968', title: 'Night of the Living Dead (1968)', year: '1968', type: 'movie', mediatype: 'movies' },
    { id: 'the-gold-rush-1925', title: 'The Gold Rush (1925)', year: '1925', type: 'movie', mediatype: 'movies' },
    { id: 'the-general-1926', title: 'The General (1926)', year: '1926', type: 'movie', mediatype: 'movies' }
  ];
}

function getSettings() {
  return [
    {
      key: 'maxResults',
      label: 'Max search results',
      description: 'Maximum number of search results to return.',
      type: 'enum',
      default: '20',
      options: [
        { value: '10', label: '10' },
        { value: '20', label: '20 (default)' },
        { value: '50', label: '50' },
        { value: '100', label: '100' }
      ]
    },
    {
      key: 'includeMovies',
      label: 'Include movies',
      description: 'Include public domain movies in search results.',
      type: 'bool',
      default: true
    },
    {
      key: 'includeTV',
      label: 'Include TV shows',
      description: 'Include public domain TV shows in search results.',
      type: 'bool',
      default: true
    }
  ];
}

function getInfo() {
  return {
    name: 'Internet Archive',
    lang: 'en',
    baseUrl: 'https://archive.org',
    logo: 'https://archive.org/images/archive-icon.png',
    type: 'movie',
    version: VERSION
  };
}

// ── Search ───────────────────────────────────────────────────────────────

function search(q) {
  var maxResults = _num('maxResults', 20);
  var includeMovies = _bool('includeMovies', true);
  var includeTV = _bool('includeTV', true);

  var mediatypeFilters = [];
  if (includeMovies) mediatypeFilters.push('mediatype:movies');
  if (includeTV) mediatypeFilters.push('mediatype:tv');
  var mt = mediatypeFilters.length ? '(' + mediatypeFilters.join(' OR ') + ')' : '';

  // Search across title, description, and creator fields
  var qq = _q(q);
  var url = IA_SEARCH + '?q=' + _q(mt + ' AND (' + qq + ')') +
            '&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year&fl[]=mediatype' +
            '&fl[]=format&fl[]=size&rows=' + maxResults + '&output=json';

  return _get(url).then(function (data) {
    var docs = data && data.response && data.response.docs;
    if (!Array.isArray(docs)) return [];
    return docs.map(function (d) {
      var year = d.year || '';
      if (Array.isArray(year)) year = year[0] || '';
      return {
        id: d.identifier || '',
        title: d.title || d.identifier || '',
        description: d.description || '',
        year: String(year),
        mediatype: d.mediatype || '',
        format: d.format || ''
      };
    });
  });
}

// ── Detail ───────────────────────────────────────────────────────────────

function getDetail(id) {
  if (!id) return Promise.resolve(null);
  return _get(IA_METADATA + '/' + _q(id)).then(function (meta) {
    if (!meta || !meta.metadata) return null;
    var m = meta.metadata;
    var files = meta.files || [];
    var videoFile = _pickBestVideoFile(files);
    var streamUrl = '';
    if (videoFile) {
      streamUrl = IA_DOWNLOAD + '/' + _q(id) + '/' + _q(videoFile.name);
    }
    var year = m.year || '';
    if (Array.isArray(year)) year = year[0] || '';
    return {
      id: id,
      title: m.title || id,
      description: m.description || '',
      year: String(year),
      genre: m.subject || '',
      language: m.language || '',
      cover: streamUrl ? '' : '', // No poster from IA metadata directly
      streamUrl: streamUrl,
      isMovie: m.mediatype === 'movies',
      isTV: m.mediatype === 'tv'
    };
  });
}

// ── Stream extraction ────────────────────────────────────────────────────

function getVideoSources(id, opts) {
  opts = opts || {};
  if (!id) return Promise.resolve([]);
  return _get(IA_METADATA + '/' + _q(id)).then(function (meta) {
    if (!meta || !meta.files) return [];
    var videoFiles = _pickVideoFiles(meta.files);
    if (videoFiles.length === 0) return [];
    return videoFiles.map(function (videoFile) {
      var streamUrl = IA_DOWNLOAD + '/' + _q(id) + '/' + _q(videoFile.name);
      var size = videoFile.size || 0;
      var label = videoFile.name;
      var q = '';
      var n = String(videoFile.name).toLowerCase();
      if (n.indexOf('1080') >= 0) q = '1080p';
      else if (n.indexOf('720') >= 0) q = '720p';
      else if (n.indexOf('480') >= 0) q = '480p';
      else if (size > 1000000000) q = '1080p';
      else if (size > 500000000) q = '720p';
      else if (size > 100000000) q = '480p';
      else q = 'SD';
      return {
        url: streamUrl,
        quality: q || 0,
        label: label,
        container: 'mp4',
        headers: { 'User-Agent': UA, 'Accept': 'video/mp4,*/*' },
        kind: 'direct',
        source: 'Internet Archive',
        subtitles: []
      };
    });
  });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }

function getEpisodes(id) {
  return Promise.resolve([]);
}

// ── Settings helpers (local) ─────────────────────────────────────────────

function _num(key, def) {
  var v = null;
  try { v = (typeof __settings !== 'undefined' && __settings && __settings[SOURCE_ID] && __settings[SOURCE_ID][key] != null) ? __settings[SOURCE_ID][key] : (__settings && __settings[key] != null ? __settings[key] : null); } catch (e) {}
  var n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : def;
}
function _bool(key, def) {
  var v = null;
  try { v = (typeof __settings !== 'undefined' && __settings && __settings[SOURCE_ID] && __settings[SOURCE_ID][key] != null) ? __settings[SOURCE_ID][key] : (__settings && __settings[key] != null ? __settings[key] : null); } catch (e) {}
  if (v == null || v === '') return !!def;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

// ── Exports ──────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    _SOURCE_ID: SOURCE_ID
  };
}