/*
 * MovieBox IN source for Zangetsu.
 *
 * Modified JavaScript port of MovieBoxProviderIN.kt from
 * NivinCNC/CNCVerse-Cloud-Stream-Extension at commit
 * 06aa5b48d49e5ec40c26a689a526f9e2a79bab70.
 * Copyright (C) NivinCNC.
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This port is adapted for the Zangetsu provider interface. It was not written
 * or endorsed by MovieBox or the upstream extension project.
 */

var SOURCE_ID = 'moviebox-in';
var API_BASE = 'https://api.inmoviebox.com';
var API_BASES = [
  'https://api.inmoviebox.com',
  'https://api6.aoneroom.com'
];
var API_ROOT = API_BASE + '/wefeed-mobile-bff';
var APP_VERSION = '3.0.03.0529.03';
var APP_VERSION_CODE = 50020042;
var UA = 'com.community.mbox.in/' + APP_VERSION_CODE + ' (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)';
var CLIENT_INFO = JSON.stringify({
  package_name: 'com.community.mbox.in',
  version_name: APP_VERSION,
  version_code: APP_VERSION_CODE,
  os: 'android',
  os_version: '16',
  device_id: 'da2b99c821e6ea023e4be55b54d5f7d8',
  install_store: 'ps',
  gaid: 'd7578036d13336cc',
  brand: 'google',
  model: 'sdk_gphone64_x86_64',
  system_language: 'en',
  net: 'NETWORK_WIFI',
  region: 'IN',
  timezone: 'Asia/Calcutta',
  sp_code: ''
});

/*
 * Public MovieBox gateway signing defaults. The upstream Kotlin extension
 * reads build-time secrets that are not included in its source tree.
 */
var SECRET_KEY_DEFAULT = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
var SECRET_KEY_ALT = 'Xqn2nnO41/L92o1iuXhSLHTbXvY4Z5ZZ62m8mSLA';

var _authToken = '';
var _authUserId = '';
var _sessionPromise = null;
var _lastBootstrapAt = 0;
var _activeAPIBase = API_BASE;

function getInfo() {
  return {
    name: 'MovieBox IN',
    lang: 'ta',
    baseUrl: API_BASE,
    logo: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/06aa5b48d49e5ec40c26a689a526f9e2a79bab70/MovieBoxProviderIN/icon.png',
    type: 'movie',
    version: '1.0.2'
  };
}

function getSettings() {
  return [];
}

function _utf8Bytes(value) {
  var encoded = encodeURIComponent(String(value == null ? '' : value));
  var bytes = [];
  for (var i = 0; i < encoded.length; i++) {
    if (encoded.charAt(i) === '%') {
      bytes.push(parseInt(encoded.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

function _md5Bytes(input) {
  var bytes = input.slice();
  var bitLength = input.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var low = bitLength >>> 0;
  var high = Math.floor(bitLength / 4294967296) >>> 0;
  for (var li = 0; li < 4; li++) bytes.push((low >>> (li * 8)) & 255);
  for (var hi = 0; hi < 4; hi++) bytes.push((high >>> (hi * 8)) & 255);

  var shifts = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
  ];
  var constants = [];
  for (var ci = 0; ci < 64; ci++) constants.push(Math.floor(Math.abs(Math.sin(ci + 1)) * 4294967296) | 0);

  var a0 = 0x67452301 | 0;
  var b0 = 0xefcdab89 | 0;
  var c0 = 0x98badcfe | 0;
  var d0 = 0x10325476 | 0;

  for (var offset = 0; offset < bytes.length; offset += 64) {
    var words = [];
    for (var wi = 0; wi < 16; wi++) {
      var p = offset + wi * 4;
      words[wi] = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) | 0;
    }
    var a = a0, b = b0, c = c0, d = d0;
    for (var i = 0; i < 64; i++) {
      var f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      var oldD = d;
      d = c;
      c = b;
      var sum = (a + f + constants[i] + words[g]) | 0;
      var rotated = (sum << shifts[i]) | (sum >>> (32 - shifts[i]));
      b = (b + rotated) | 0;
      a = oldD;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  var state = [a0, b0, c0, d0];
  var output = [];
  for (var si = 0; si < state.length; si++) {
    output.push(state[si] & 255);
    output.push((state[si] >>> 8) & 255);
    output.push((state[si] >>> 16) & 255);
    output.push((state[si] >>> 24) & 255);
  }
  return output;
}

function _hex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  return out;
}

function _base64Decode(value) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var input = String(value || '').replace(/[^A-Za-z0-9+/=]/g, '');
  var output = [];
  var buffer = 0, bits = 0;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (ch === '=') break;
    var n = alphabet.indexOf(ch);
    if (n < 0) continue;
    buffer = (buffer << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 255);
    }
  }
  return output;
}

function _base64Encode(bytes) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i] & 255;
    var hasB = i + 1 < bytes.length;
    var hasC = i + 2 < bytes.length;
    var b = hasB ? bytes[i + 1] & 255 : 0;
    var c = hasC ? bytes[i + 2] & 255 : 0;
    var triple = (a << 16) | (b << 8) | c;
    out += alphabet.charAt((triple >>> 18) & 63);
    out += alphabet.charAt((triple >>> 12) & 63);
    out += hasB ? alphabet.charAt((triple >>> 6) & 63) : '=';
    out += hasC ? alphabet.charAt(triple & 63) : '=';
  }
  return out;
}

function _hmacMd5Base64(secret, message) {
  var key = _base64Decode(secret);
  if (key.length > 64) key = _md5Bytes(key);
  while (key.length < 64) key.push(0);
  var innerPad = [], outerPad = [];
  for (var i = 0; i < 64; i++) {
    innerPad.push(key[i] ^ 0x36);
    outerPad.push(key[i] ^ 0x5c);
  }
  var inner = _md5Bytes(innerPad.concat(_utf8Bytes(message)));
  return _base64Encode(_md5Bytes(outerPad.concat(inner)));
}

function _canonicalUrl(url) {
  var parsed = new URL(url);
  var valuesByKey = {};
  parsed.searchParams.forEach(function (value, key) {
    if (!Object.prototype.hasOwnProperty.call(valuesByKey, key)) valuesByKey[key] = [];
    valuesByKey[key].push(value);
  });
  var keys = Object.keys(valuesByKey).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var values = valuesByKey[keys[i]];
    for (var j = 0; j < values.length; j++) parts.push(keys[i] + '=' + values[j]);
  }
  return parsed.pathname + (parts.length ? '?' + parts.join('&') : '');
}

function _canonicalString(method, accept, contentType, url, body, timestamp) {
  var bytes = body === null ? null : _utf8Bytes(body);
  var bodyHash = bytes === null ? '' : _hex(_md5Bytes(bytes.slice(0, 102400)));
  var bodyLength = bytes === null ? '' : String(bytes.length);
  return String(method || 'GET').toUpperCase() + '\n' +
    String(accept == null ? '' : accept) + '\n' +
    String(contentType == null ? '' : contentType) + '\n' +
    bodyLength + '\n' + String(timestamp) + '\n' + bodyHash + '\n' +
    _canonicalUrl(url);
}

function _signedHeaders(url, method, body, secret, options) {
  options = options || {};
  var timestamp = String(Date.now());
  var accept = options.accept !== undefined ? String(options.accept) : 'application/json';
  var contentType = options.contentType !== undefined ? String(options.contentType) : 'application/json';
  var signatureContentType = options.signatureContentType !== undefined
    ? String(options.signatureContentType)
    : contentType;
  var canonical = _canonicalString(method, accept, signatureContentType, url, body, timestamp);
  var tokenHash = _hex(_md5Bytes(_utf8Bytes(timestamp.split('').reverse().join(''))));
  var headers = {
    'user-agent': UA,
    'accept': accept,
    'content-type': contentType,
    'connection': 'keep-alive',
    'x-client-token': timestamp + ',' + tokenHash,
    'x-tr-signature': timestamp + '|2|' + _hmacMd5Base64(secret, canonical),
    'x-client-info': CLIENT_INFO,
    'x-client-status': options.clientStatus != null ? String(options.clientStatus) : '0'
  };
  if (options.playMode === true) headers['x-play-mode'] = '2';
  return headers;
}

function _captureAuthFromHeaders(headers) {
  if (!headers) return false;
  var raw = '';
  try {
    if (typeof headers.get === 'function') raw = headers.get('x-user') || headers.get('X-User') || '';
  } catch (e) {}
  if (!raw && typeof headers === 'object') {
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() !== 'x-user') continue;
      raw = headers[keys[i]];
      if (Array.isArray(raw)) raw = raw.join(', ');
      break;
    }
  }
  if (!raw) return false;
  var parsed = null;
  var rawText = String(raw).trim();
  try { parsed = JSON.parse(rawText); } catch (e) {}
  var token = '';
  var userId = '';
  if (parsed && typeof parsed === 'object') {
    token = parsed.token || parsed.accessToken || parsed.access_token ||
      (parsed.data && (parsed.data.token || parsed.data.accessToken)) || '';
    userId = parsed.userId || parsed.user_id ||
      (parsed.data && (parsed.data.userId || parsed.data.user_id)) || '';
  } else if (typeof parsed === 'string') {
    token = parsed;
  } else if (/^Bearer\s+/i.test(rawText) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(rawText)) {
    token = rawText;
  }
  token = String(token || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  _authToken = token;
  _authUserId = String(userId || '');
  return true;
}

function _decodeResponse(response) {
  if (!response) return Promise.reject(new Error('MovieBox IN: empty HTTP response'));
  var status = Number(response.status);
  if (!isFinite(status) || status <= 0) status = response.ok === false ? 500 : 200;
  var headers = response.headers || {};
  // The reference provider does not consume an x-user guest-token handshake.

  function parseBody(raw) {
    var data = null;
    if (raw && typeof raw === 'object') {
      data = raw;
      raw = JSON.stringify(raw);
    } else {
      raw = String(raw == null ? '' : raw);
      if (raw) {
        try { data = JSON.parse(raw); } catch (e) { data = null; }
      }
    }
    return {
      status: status,
      ok: status >= 200 && status < 300,
      data: data,
      raw: raw,
      headers: headers,
      url: response.url || ''
    };
  }

  if (typeof response.body === 'string') return Promise.resolve(parseBody(response.body));
  if (response.body && typeof response.body === 'object' && typeof response.body.getReader !== 'function') {
    return Promise.resolve(parseBody(response.body));
  }
  if (typeof response.text === 'function') {
    return Promise.resolve().then(function () { return response.text(); }).then(parseBody);
  }
  return Promise.resolve(parseBody(''));
}

function _isAuthFailure(result) {
  if (!result) return false;
  if (result.status === 401 || result.status === 403 || result.status === 440) return true;
  var data = result.data || {};
  var code = Number(data.code);
  if (code === 401 || code === 403 || code === 440) return true;
  var message = String(data.message || data.msg || data.error || '');
  return /invalid.{0,20}(signature|token)|(?:signature|token).{0,20}(invalid|expired|error)/i.test(message);
}

function _sendSigned(url, method, body, options, secret) {
  options = options || {};
  var headers = _signedHeaders(url, method, body, secret, options);
  var init = {
    method: method,
    headers: headers,
    timeoutMs: options.timeoutMs || 8000
  };
  if (body !== null) init.body = body;
  return Promise.resolve().then(function () {
    return fetch(url, init);
  }).then(_decodeResponse);
}

function _apiUrl(base, path, withoutPrefix) {
  var route = String(path || '');
  if (!route) route = '/';
  if (route.charAt(0) !== '/') route = '/' + route;
  var prefix = withoutPrefix ? '' : '/wefeed-mobile-bff';
  return String(base).replace(/\/+$/, '') + prefix + route;
}

function _requestWithSigningFallback(url, method, body, options, allowRefresh) {
  return _sendSigned(url, method, body, options, SECRET_KEY_DEFAULT).then(function (first) {
    if (!_isAuthFailure(first)) return first;
    return _sendSigned(url, method, body, options, SECRET_KEY_ALT);
  });
}

function _bootstrapAtBase(base) {
  var url = _apiUrl(base, '/tab-operating?page=1&pageSize=24&tabId=1');
  var options = {
    anonymous: true,
    clientStatus: '1',
    playMode: true,
    timeoutMs: 3500,
    accept: 'application/json',
    contentType: 'application/json;charset=UTF-8'
  };
  return _sendSigned(url, 'GET', null, options, SECRET_KEY_DEFAULT).then(function (first) {
    if (_authToken) return true;
    if (first.ok || _isAuthFailure(first)) {
      return _sendSigned(url, 'GET', null, options, SECRET_KEY_ALT).then(function () {
        return !!_authToken;
      }).catch(function () {
        return !!_authToken;
      });
    }
    return false;
  }).catch(function () {
    return false;
  });
}

function _ensureGuestToken(force) {
  if (_authToken && !force) return Promise.resolve(true);
  if (force) {
    _authToken = '';
    _authUserId = '';
  }
  if (_sessionPromise) return _sessionPromise;
  var now = Date.now();
  if (!force && _lastBootstrapAt && now - _lastBootstrapAt < 12000) {
    return Promise.resolve(false);
  }
  _lastBootstrapAt = now;
  var index = 0;
  function nextBase() {
    if (_authToken) return Promise.resolve(true);
    if (index >= Math.min(API_BASES.length, 2)) return Promise.resolve(false);
    var base = API_BASES[index++];
    return _bootstrapAtBase(base).then(function (ok) {
      if (ok || _authToken) return true;
      return nextBase();
    });
  }
  _sessionPromise = nextBase().then(function (ok) {
    if (!ok && !_authToken) console.warn('MovieBox IN: guest-token bootstrap did not return x-user; trying anonymous requests');
    _sessionPromise = null;
    return !!_authToken;
  }).catch(function (error) {
    console.warn('MovieBox IN: guest-token bootstrap failed:', String(error));
    _sessionPromise = null;
    return false;
  });
  return _sessionPromise;
}

function _request(path, options) {
  options = options || {};
  var method = String(options.method || 'GET').toUpperCase();
  var body = options.rawBody != null
    ? String(options.rawBody)
    : (options.data === undefined ? null : JSON.stringify(options.data));

  function check(result, requestPath) {
    if (_isAuthFailure(result)) {
      var info = result && result.data ? (result.data.message || result.data.msg || result.data.error || '') : '';
      throw new Error('MovieBox IN: authorization/signature rejected at ' + requestPath + (info ? ' (' + info + ')' : ''));
    }
    if (!result.ok) {
      throw new Error('MovieBox IN: HTTP ' + result.status + ' at ' + requestPath + ' (' + String(result.raw || '').slice(0, 180) + ')');
    }
    if (!result.data || typeof result.data !== 'object') {
      throw new Error('MovieBox IN: invalid JSON at ' + requestPath);
    }
    return result.data;
  }

  function requestAtBase(index, withoutPrefix) {
    var base = API_BASES[index];
    var url = _apiUrl(base, path, withoutPrefix);
    return _requestWithSigningFallback(url, method, body, options, true).then(function (result) {
      if (result.status === 404 && !withoutPrefix) {
        return requestAtBase(index, true);
      }
      var message = String(result.data && (result.data.message || result.data.msg || result.data.error) || '');
      if (index + 1 < API_BASES.length &&
          /service not available in current region/i.test(message)) {
        return requestAtBase(index + 1, false);
      }
      if ((result.status === 404 || result.status >= 500 || result.status === 0) && index + 1 < API_BASES.length) {
        return requestAtBase(index + 1, false);
      }
      var value = check(result, path);
      _activeAPIBase = base;
      return value;
    }, function (error) {
      if (index + 1 < API_BASES.length) return requestAtBase(index + 1, false);
      throw error;
    });
  }

  return requestAtBase(0, false);
}

function _apiPath(path, values) {
  var query = [];
  var keys = Object.keys(values || {});
  for (var i = 0; i < keys.length; i++) {
    query.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(String(values[keys[i]])));
  }
  return path + (query.length ? '?' + query.join('&') : '');
}

function _subjectId(value) {
  if (value && typeof value === 'object') {
    if (value.subjectId != null) return String(value.subjectId);
    if (value.id != null) return _subjectId(value.id);
    if (value.url != null) return _subjectId(value.url);
  }
  var s = String(value == null ? '' : value);
  if (!s) return '';
  if (s.indexOf('moviebox-in://') === 0) {
    return decodeURIComponent(s.slice('moviebox-in://'.length).split(/[/?#]/)[0]);
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      var parsed = new URL(s);
      if (parsed.searchParams.get('subjectId')) return parsed.searchParams.get('subjectId');
    } catch (e) {}
  }
  if (/^\d+$/.test(s)) return s;
  return s.split(/[|/]/)[0];
}

function _item(subject) {
  if (!subject) return null;
  var rawId = subject.subjectId != null ? subject.subjectId : subject.id;
  var rawTitle = subject.title || subject.name || subject.subjectName;
  if (rawId == null || rawTitle == null) return null;
  var id = String(rawId);
  var title = String(rawTitle || '').trim();
  if (!id || !title) return null;
  var cover = subject.cover && (subject.cover.url || subject.cover.coverUrl || subject.cover.posterUrl) ||
    subject.coverUrl || subject.posterUrl || subject.poster || null;
  var rawType = subject.subjectType != null ? subject.subjectType : subject.type;
  return {
    id: 'moviebox-in://' + encodeURIComponent(id),
    title: title,
    cover: cover,
    url: 'moviebox-in://' + encodeURIComponent(id),
    type: Number(rawType) === 2 ? 'tv' : 'movie',
    sourceId: SOURCE_ID,
    movieBoxSubjectId: id,
    movieBoxSubjectType: Number(rawType) || 1
  };
}

function _items(subjects) {
  var out = [], seen = {};
  for (var i = 0; i < (subjects || []).length; i++) {
    var item = _item(subjects[i]);
    if (item && !seen[item.url]) {
      seen[item.url] = true;
      out.push(item);
    }
  }
  return out;
}

function getHome(opts) {
  var homePath = '/tab-operating?page=1&tabId=0&version=';
  return _request(homePath, { playMode: true }).then(function (response) {
    var sections = response && response.data && Array.isArray(response.data.items) ? response.data.items : [];
    var rows = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i] || {};
      var title = String(section.title || '').trim();
      if (!title) continue;
      if (title.toLowerCase() === 'banner') title = 'Top Picks';
      var media = [];
      if (section.type === 'BANNER') {
        var banners = section.banner && Array.isArray(section.banner.banners) ? section.banner.banners : [];
        for (var j = 0; j < banners.length; j++) {
          if (banners[j] && banners[j].subject) media.push(banners[j].subject);
        }
      } else if (section.type === 'SUBJECTS_MOVIE') {
        media = Array.isArray(section.subjects) ? section.subjects : [];
      } else if (section.type === 'CUSTOM') {
        var custom = section.customData && Array.isArray(section.customData.items) ? section.customData.items : [];
        for (var k = 0; k < custom.length; k++) {
          if (custom[k] && custom[k].subject) media.push(custom[k].subject);
        }
      }
      var mapped = _items(media);
      if (mapped.length) rows.push({ title: title, items: mapped });
    }
    return rows;
  }).catch(function (error) {
    console.warn('MovieBox IN home failed:', String(error));
    return [];
  });
}

function _searchSubjects(response) {
  var data = response && response.data ? response.data : response;
  if (data && data.data && typeof data.data === 'object') data = data.data;
  var subjects = [];
  var results = data && Array.isArray(data.results) ? data.results : [];
  for (var i = 0; i < results.length; i++) {
    var row = results[i] || {};
    if (Array.isArray(row.subjects)) subjects = subjects.concat(row.subjects);
    else if (row.subjectId != null || row.id != null) subjects.push(row);
    else if (Array.isArray(row.items)) subjects = subjects.concat(row.items);
  }
  if (data && Array.isArray(data.subjects)) subjects = subjects.concat(data.subjects);
  if (data && Array.isArray(data.items)) subjects = subjects.concat(data.items);
  if (data && Array.isArray(data.list)) subjects = subjects.concat(data.list);
  return _items(subjects);
}

function _searchCurrentEndpoint(query, page) {
  return _request('/subject-api/search', {
    method: 'POST',
    data: { keyword: query, q: query, page: page, pageSize: 20, type: 0 }
  }).then(function (response) {
    return _searchSubjects(response);
  });
}

function search(query, page, opts) {
  var q = String(query == null ? '' : query).trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var sourceBody = '{"page": ' + p + ', "perPage": 10, "keyword": ' + JSON.stringify(q) + '}';
  return _request('/subject-api/search/v2', {
    method: 'POST',
    rawBody: sourceBody,
    signatureContentType: 'application/json; charset=utf-8'
  }).then(function (response) {
    var rows = _searchSubjects(response);
    if (rows.length) return rows;
    return _searchCurrentEndpoint(q, p);
  }).catch(function (error) {
    console.warn('MovieBox IN v2 search failed; trying current search endpoint:', String(error));
    return _searchCurrentEndpoint(q, p).catch(function (fallbackError) {
      console.warn('MovieBox IN search failed:', String(fallbackError));
      return [];
    });
  });
}

function _episodeUrl(subjectId, season, episode) {
  return 'moviebox-in-episode://' + encodeURIComponent(JSON.stringify({
    subjectId: String(subjectId),
    season: Number(season) || 0,
    episode: Number(episode) || 0
  }));
}

function _episodePayload(value) {
  if (value && typeof value === 'object') {
    if (value.subjectId != null) {
      return {
        subjectId: String(value.subjectId),
        season: Math.max(0, parseInt(value.season, 10) || 0),
        episode: Math.max(0, parseInt(value.episode, 10) || 0)
      };
    }
    if (value.url != null) return _episodePayload(value.url);
    if (value.id != null) return _episodePayload(value.id);
  }
  var s = String(value == null ? '' : value);
  if (s.indexOf('moviebox-in-episode://') === 0) {
    try {
      return JSON.parse(decodeURIComponent(s.slice('moviebox-in-episode://'.length)));
    } catch (e) { return null; }
  }
  var parts = s.split('|');
  if (parts.length > 1 && parts[0]) {
    return {
      subjectId: _subjectId(parts[0]),
      season: Math.max(0, parseInt(parts[1], 10) || 0),
      episode: Math.max(0, parseInt(parts[2], 10) || 0)
    };
  }
  var id = _subjectId(s);
  return id ? { subjectId: id, season: 0, episode: 0 } : null;
}

function _durationMinutes(value) {
  var s = String(value == null ? '' : value).trim();
  var hm = s.match(/(\d+)\s*h\s*(\d+)\s*m/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  var h = s.match(/(\d+)\s*h/i);
  if (h) return Number(h[1]) * 60;
  var m = s.match(/(\d+)\s*m/i);
  if (m) return Number(m[1]);
  var n = parseInt(s, 10);
  return isFinite(n) && n > 0 ? n : null;
}

function _genres(value) {
  if (Array.isArray(value)) {
    return value.map(function (g) {
      if (typeof g === 'string') return g.trim();
      return g && (g.name || g.title) ? String(g.name || g.title) : '';
    }).filter(Boolean);
  }
  return String(value || '').split(',').map(function (g) { return g.trim(); }).filter(Boolean);
}

function _parseActors(list) {
  var actors = [];
  for (var i = 0; i < (list || []).length; i++) {
    var staff = list[i] || {};
    if (Number(staff.staffType) !== 1 || !staff.name) continue;
    actors.push({
      name: String(staff.name),
      role: staff.character ? String(staff.character) : '',
      image: staff.avatarUrl || null
    });
  }
  return actors;
}

function getDetail(url, opts) {
  var id = _subjectId(url);
  if (!id) return Promise.resolve(null);
  return _request(_apiPath('/subject-api/get', { subjectId: id }), { playMode: true }).then(function (response) {
    var data = response && response.data;
    if (!data || !data.title) return null;
    var subjectType = Number(data.subjectType) || 1;
    var cover = data.cover && data.cover.url ? data.cover.url : null;
    var releaseDate = String(data.releaseDate || '');
    var year = parseInt(releaseDate.slice(0, 4), 10);
    if (!isFinite(year)) year = Number(data.year) || null;
    var rating = parseFloat(data.imdbRatingValue);
    var detail = {
      id: 'moviebox-in://' + encodeURIComponent(id),
      title: String(data.title),
      cover: cover,
      banner: cover,
      url: 'moviebox-in://' + encodeURIComponent(id),
      description: String(data.description || ''),
      status: 'unknown',
      genres: _genres(data.genre),
      studios: [],
      actors: _parseActors(data.staffList),
      type: subjectType === 2 ? 'tv' : 'movie',
      sourceId: SOURCE_ID,
      year: year,
      score: isFinite(rating) ? Math.round(rating * 10) : null,
      duration: _durationMinutes(data.duration),
      country: data.countryName || null,
      movieBoxSubjectId: id,
      movieBoxSubjectType: subjectType,
      episodes: []
    };
    if (subjectType !== 2) {
      detail.episodes = [{
        id: 'movie',
        title: detail.title,
        number: 1,
        season: 0,
        episode: 0,
        url: _episodeUrl(id, 0, 0)
      }];
      return detail;
    }
    return _request(_apiPath('/subject-api/season-info', { subjectId: id }), {}).then(function (seasonResponse) {
      var seasons = seasonResponse && seasonResponse.data && Array.isArray(seasonResponse.data.seasons)
        ? seasonResponse.data.seasons : [];
      var episodes = [];
      for (var i = 0; i < seasons.length; i++) {
        var season = seasons[i] || {};
        var seasonNo = Math.max(1, parseInt(season.se, 10) || 1);
        var maxEpisodes = Math.min(500, Math.max(0, parseInt(season.maxEp, 10) || 0));
        for (var ep = 1; ep <= maxEpisodes; ep++) {
          episodes.push({
            id: 'S' + seasonNo + 'E' + ep,
            title: 'S' + (seasonNo < 10 ? '0' : '') + seasonNo + 'E' + (ep < 10 ? '0' : '') + ep,
            number: ep,
            season: seasonNo,
            episode: ep,
            url: _episodeUrl(id, seasonNo, ep)
          });
        }
      }
      if (!episodes.length) {
        episodes.push({
          id: 'S1E1',
          title: 'Episode 1',
          number: 1,
          season: 1,
          episode: 1,
          url: _episodeUrl(id, 1, 1)
        });
      }
      detail.episodes = episodes;
      return detail;
    }).catch(function () {
      detail.episodes = [{
        id: 'S1E1', title: 'Episode 1', number: 1, season: 1, episode: 1,
        url: _episodeUrl(id, 1, 1)
      }];
      return detail;
    });
  }).catch(function (error) {
    console.warn('MovieBox IN detail failed:', String(error));
    return null;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

function _quality(value) {
  var s = String(value == null ? '' : value);
  var match = s.match(/(2160|1440|1080|720|540|480|360)\s*p?/i);
  return match ? match[1] + 'p' : 'auto';
}

function _absoluteUrl(value) {
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^(?:https?:|magnet:)/i.test(s)) return s;
  if (s.indexOf('//') === 0) return 'https:' + s;
  try { return new URL(s, (_activeAPIBase || API_BASE) + '/').toString(); }
  catch (e) { return s; }
}

function _container(url, format) {
  var u = String(url || '').toLowerCase();
  var f = String(format || '').toLowerCase();
  if (u.indexOf('magnet:') === 0) return 'magnet';
  if (/\.(?:torrent)(?:[?#]|$)/i.test(u)) return 'torrent';
  if (f === 'dash' || /\.mpd(?:[?#]|$)/i.test(u)) return 'dash';
  if (f === 'hls' || /\.m3u8(?:[?#]|$)/i.test(u)) return 'hls';
  return 'mp4';
}

function _captionRows(response, language, resolution) {
  var data = response && response.data ? response.data : response;
  if (data && data.data && typeof data.data === 'object') data = data.data;
  var list = data && (data.extCaptions || data.subTitleList || data.subtitles || data.captions || data.items);
  if (!Array.isArray(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var caption = list[i] || {};
    var url = _absoluteUrl(caption.url || caption.src || caption.file || caption.subtitleUrl);
    if (!url) continue;
    var lang = String(caption.language || caption.lanName || caption.lan || caption.label || caption.name || 'Unknown');
    out.push({
      url: url,
      lang: lang + ' (' + language + (resolution ? ' - ' + resolution : '') + ')',
      language: lang
    });
  }
  return out;
}

function _mergeCaptionRows(first, second) {
  var out = [], seen = {};
  var rows = (first || []).concat(second || []);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (!row.url) continue;
    var key = String(row.url) + '|' + String(row.language || row.lang || '');
    if (seen[key]) continue;
    seen[key] = true;
    out.push(row);
  }
  return out;
}

function _loadCaptions(subjectId, streamId, language, resolution) {
  var resourceId = String(streamId || (subjectId + '|0|0'));
  var urls = [
    _apiPath('/subject-api/get-stream-captions', { subjectId: subjectId, streamId: resourceId }),
    _apiPath('/subject-api/get-ext-captions', { subjectId: subjectId, resourceId: resourceId, episode: 0 })
  ];
  return Promise.all(urls.map(function (path) {
    return _request(path, { accept: '', contentType: '' }).catch(function (error) {
      console.warn('MovieBox IN caption request failed:', path, String(error));
      return null;
    });
  })).then(function (responses) {
    var out = [];
    for (var i = 0; i < responses.length; i++) {
      out = _mergeCaptionRows(out, _captionRows(responses[i], language, resolution));
    }
    return out;
  });
}

function _resolveStreamsForLanguage(subjectId, season, episode, language, isOriginal) {
  var playPath = _apiPath('/subject-api/play-info', {
    subjectId: subjectId, se: season, ep: episode
  });
  return _request(playPath, {}).then(function (response) {
    var data = response && response.data;
    if (data && data.data && typeof data.data === 'object') data = data.data;
    var streams = data && Array.isArray(data.streams) ? data.streams
      : (data && Array.isArray(data.streamList) ? data.streamList : []);
    var inlineCaptions = _captionRows({
      data: { extCaptions: data && (data.subTitleList || data.subtitles || data.extCaptions) || [] }
    }, language, '');
    return Promise.all(streams.map(function (stream) {
      stream = stream || {};
      var url = _absoluteUrl(stream.url || stream.sourceUrl || stream.playUrl || stream.src);
      if (!url) return [];
      var resolution = String(stream.resolutions || stream.resolution || stream.quality || '');
      var streamId = String(stream.id || stream.resourceId || stream.postId || (subjectId + '|' + season + '|' + episode));
      var signCookie = stream.signCookie || stream.sign_cookie || (data && (data.signCookie || data.sign_cookie)) || '';
      function buildSource(subtitles) {
        var headers = {
          'User-Agent': UA,
          'Referer': (_activeAPIBase || API_BASE) + '/',
          'Origin': (_activeAPIBase || API_BASE)
        };
        if (signCookie) headers.Cookie = String(signCookie);
        return {
          url: url,
          quality: _quality(resolution),
          container: _container(url, stream.format || stream.type),
          headers: headers,
          kind: isOriginal ? 'sub' : 'dub',
          audioLang: language === 'Original' ? '' : language,
          subtitles: _mergeCaptionRows(subtitles, inlineCaptions),
          label: 'MovieBox IN (' + language + (resolution ? ' - ' + resolution : '') + ')',
          sourceId: SOURCE_ID,
          codec: stream.codecName || stream.codec || 'h264'
        };
      }
      return _loadCaptions(subjectId, streamId, language, resolution).then(buildSource).catch(function (error) {
        console.warn('MovieBox IN caption parsing failed:', String(error));
        return buildSource([]);
      });
    })).then(function (groups) {
      var out = [];
      for (var i = 0; i < groups.length; i++) out = out.concat(groups[i] || []);
      return out;
    });
  }).catch(function (error) {
    console.warn('MovieBox IN play-info failed for ' + subjectId + ' S' + season + 'E' + episode + ':', String(error));
    return [];
  });
}

function getVideoSources(value, opts) {
  var episode = _episodePayload(value);
  if (!episode || !episode.subjectId) return Promise.resolve([]);
  var id = String(episode.subjectId);
  var season = Math.max(0, parseInt(episode.season, 10) || 0);
  var epNo = Math.max(0, parseInt(episode.episode, 10) || 0);
  return _request(_apiPath('/subject-api/get', { subjectId: id }), {}).then(function (response) {
    var data = response && response.data ? response.data : {};
    var dubs = Array.isArray(data.dubs) ? data.dubs : [];
    var originalLanguage = 'Original';
    var entries = [];
    for (var i = 0; i < dubs.length; i++) {
      var dub = dubs[i] || {};
      if (dub.subjectId == null || !dub.lanName) continue;
      var dubId = String(dub.subjectId);
      if (dubId === id) originalLanguage = String(dub.lanName);
      else entries.push({ subjectId: dubId, language: String(dub.lanName), isOriginal: false });
    }
    var sources = [{ subjectId: id, language: originalLanguage, isOriginal: true }].concat(entries);
    return Promise.all(sources.map(function (entry) {
      return _resolveStreamsForLanguage(entry.subjectId, season, epNo, entry.language, entry.isOriginal);
    })).then(function (groups) {
      var out = [], seen = {};
      for (var a = 0; a < groups.length; a++) {
        for (var b = 0; b < (groups[a] || []).length; b++) {
          var item = groups[a][b];
          var key = item.url + '|' + item.audioLang;
          if (!seen[key]) {
            seen[key] = true;
            out.push(item);
          }
        }
      }
      return out;
    });
  }).catch(function (error) {
    console.warn('MovieBox IN stream resolution failed:', String(error));
    return [];
  });
}

function getStreams(url, opts) {
  return getVideoSources(url, opts);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.2',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams
  };
}
