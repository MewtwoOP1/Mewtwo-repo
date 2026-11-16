// Gotaku native provider for Zangetsu. Version mirrored in index.json.
//
// Gotaku serves its catalogue through its own JSON API under /api/v1. The
// catalogue endpoints answer in plain JSON; the episode list and the episode
// playback descriptors are sealed with AES-256-GCM under a key derived with
// HKDF-SHA-256, and the sealed plaintext is zlib compressed. The seal, the
// hash and the inflate are implemented here in plain JavaScript so the source
// behaves the same under the app and under the repository's test runner.
//
// The player host gotakudl.top signs every request with the same scheme: the
// embed page hands over a stamp, the request is sealed with AES-256-GCM and the
// answer is sealed with a key derived from the nonce that was sent.
//
// Known limitation: gotakudl.top encrypts its media playlists and its
// segments per file, so the app's own player may not be able to decode them.
// What this source resolves is the site's genuine playback entry point; it
// never hands back a webpage and never invents a stream.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'gotaku';
var VERSION = '1.0.1';
var OFFICIAL_DOMAIN = 'gotaku.to';
var API_PATH = '/api/v1';
var API_VERSION = 10;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var PRIMARY_PROBE_MS = 10 * 60 * 1000;
var DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// The API seal: HKDF-SHA-256 over the two embedded byte strings, empty salt,
// "api-seal|v1" as the info, then AES-256-GCM with the marker byte in front.
var SEAL_IKM_A = [177, 255, 227, 164, 54, 143, 97, 143, 103, 157, 222, 112, 153, 102, 62, 188, 217, 241, 249, 194, 253, 248, 104, 48, 36, 152, 220, 15, 158, 111, 213, 59];
var SEAL_IKM_B = [175, 156, 45, 72, 134, 149, 133, 28, 80, 190, 70, 11, 159, 119, 64, 15, 241, 68, 60, 16, 63, 162, 128, 19, 211, 140, 94, 36, 217, 26, 174, 105];
// The player key and the HKDF salts the player host uses.
var PLAYER_KEY = [69, 142, 84, 3, 196, 10, 115, 51, 39, 6, 223, 64, 97, 147, 221, 107, 4, 10, 46, 169, 122, 107, 181, 155, 82, 178, 148, 166, 16, 6, 230, 239];
var state = { healthy: null, healthyAt: 0, primaryProbedAt: 0 };

function getInfo() {
  return { name: 'Gotaku', lang: 'en', baseUrl: 'https://' + OFFICIAL_DOMAIN,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=gotaku.to', type: 'anime', version: VERSION };
}

function getSettings() {
  return [
    { key: 'primaryDomain', label: 'Primary domain', description: 'The Gotaku domain used first. Gotaku publishes gotaku.to as its only official domain; only change this to a domain Gotaku itself announces.', type: 'text', default: OFFICIAL_DOMAIN },
    { key: 'fallbackDomains', label: 'Fallback domains', description: 'Comma or newline separated backup domains, tried in order when the primary fails. Leave this blank: Gotaku has not published an alternate domain, and lookalike domains are fake sites.', type: 'text', default: '' },
    { key: 'autoFallback', label: 'Automatic domain fallback', description: 'When the current domain fails, try the next candidate instead of giving up on the episode.', type: 'bool', default: true },
    { key: 'preferredDomain', label: 'Preferred domain', description: 'Automatic keeps using the last domain that worked. Primary always starts from the domain above and only falls back if it fails.', type: 'enum', default: 'auto', options: [{ value: 'auto', label: 'Automatic (last working domain)' }, { value: 'primary', label: 'Always start from the primary domain' }] },
    { key: 'customDomain', label: 'Custom domain override', description: 'Replaces the primary domain with a domain you trust yourself. Gotaku states that gotaku.to is its only domain, so only use this if Gotaku announced a change.', type: 'text', default: '' },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for a single Gotaku request.', type: 'enum', default: '12000', options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }, { value: '18000', label: '18 seconds' }, { value: '25000', label: '25 seconds' }] },
    { key: 'maxRetries', label: 'Maximum retries', description: 'How many times a failed request is repeated before the next domain is tried.', type: 'enum', default: '2', options: [{ value: '0', label: 'No retry' }, { value: '1', label: '1 retry' }, { value: '2', label: '2 retries' }, { value: '3', label: '3 retries' }, { value: '5', label: '5 retries' }] },
    { key: 'autoRecovery', label: 'Automatic recovery', description: 'Periodically check the primary domain again so the source returns to it once it works.', type: 'bool', default: true },
    { key: 'preferredAudio', label: 'Episode audio', description: 'Which versions of an episode to list and play.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'preferredAudioLanguage', label: 'Preferred audio language', description: 'Which audio language is tried first when an episode offers more than one.', type: 'enum', default: 'ja', options: [{ value: 'ja', label: 'Japanese (sub)' }, { value: 'en', label: 'English (dub)' }] },
    { key: 'includeSubtitles', label: 'Include subtitle tracks', description: 'Attach the subtitle tracks Gotaku publishes for an episode when they are available.', type: 'bool', default: true }
  ];
}

// ── settings and domains ─────────────────────────────────────────────────────
function _rawSetting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.gotaku || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  var text = String(value).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return fallback;
}
function _normaliseDomain(value) {
  var text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  text = text.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(text)) return '';
  return text;
}
function _domainList(value) {
  var parts = String(value == null ? '' : value).split(/[\s,]+/);
  var out = [], seen = {};
  parts.forEach(function (part) {
    var domain = _normaliseDomain(part);
    if (!domain || seen[domain]) return;
    seen[domain] = 1;
    out.push(domain);
  });
  return out;
}
function _settings() {
  return {
    primary: _normaliseDomain(_rawSetting('primaryDomain')) || OFFICIAL_DOMAIN,
    fallbacks: _domainList(_rawSetting('fallbackDomains')),
    autoFallback: _bool(_rawSetting('autoFallback'), true),
    preferred: String(_rawSetting('preferredDomain') || 'auto').toLowerCase() === 'primary' ? 'primary' : 'auto',
    custom: _normaliseDomain(_rawSetting('customDomain')) || '',
    timeoutMs: _int(_rawSetting('requestTimeoutMs'), 12000, 3000, 25000),
    retries: _int(_rawSetting('maxRetries'), 2, 0, 5),
    autoRecovery: _bool(_rawSetting('autoRecovery'), true),
    audio: String(_rawSetting('preferredAudio') || 'both').toLowerCase(),
    audioLanguage: String(_rawSetting('preferredAudioLanguage') || 'ja').toLowerCase() === 'en' ? 'en' : 'ja',
    subtitles: _bool(_rawSetting('includeSubtitles'), true)
  };
}
function _candidates() {
  var cfg = _settings();
  var primary = cfg.custom || cfg.primary;
  var list = [primary].concat(cfg.fallbacks.filter(function (d) { return d !== primary; }));
  if (cfg.preferred === 'primary') return list;
  if (state.healthy && list.indexOf(state.healthy) >= 0) {
    var reordered = [state.healthy].concat(list.filter(function (d) { return d !== state.healthy; }));
    if (reordered[0] === primary && cfg.autoRecovery && state.primaryProbedAt && Date.now() - state.primaryProbedAt < PRIMARY_PROBE_MS) return reordered;
    return reordered;
  }
  return list;
}
function _markHealthy(domain) {
  state.healthy = domain;
  state.healthyAt = Date.now();
  if (domain === (_settings().custom || _settings().primary)) state.primaryProbedAt = Date.now();
}
function _markUnhealthy(domain) {
  if (state.healthy === domain) state.healthy = null;
}

// ── plain JavaScript crypto ──────────────────────────────────────────────────
function _sha256Bytes(input) {
  var primes = [], constants = [], initial = [];
  for (var n = 2; primes.length < 64; n++) {
    if (primes.every(function (p) { return n % p !== 0; })) {
      primes.push(n);
      constants.push((Math.pow(n, 1 / 3) * 4294967296) | 0);
      if (initial.length < 8) initial.push((Math.sqrt(n) * 4294967296) | 0);
    }
  }
  var bytes = input.slice(), length = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (var i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (length >>> (i * 8)) & 255);
  function rotate(x, n) { return (x >>> n) | (x << (32 - n)); }
  var h = initial;
  for (var offset = 0; offset < bytes.length; offset += 64) {
    var w = [];
    for (i = 0; i < 16; i++) w[i] = (bytes[offset + 4 * i] << 24) | (bytes[offset + 4 * i + 1] << 16) | (bytes[offset + 4 * i + 2] << 8) | bytes[offset + 4 * i + 3];
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) | 0;
    }
    var a = h.slice();
    for (i = 0; i < 64; i++) {
      var t1 = (a[7] + (rotate(a[4], 6) ^ rotate(a[4], 11) ^ rotate(a[4], 25)) + ((a[4] & a[5]) ^ (~a[4] & a[6])) + constants[i] + w[i]) | 0;
      var t2 = ((rotate(a[0], 2) ^ rotate(a[0], 13) ^ rotate(a[0], 22)) + ((a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]))) | 0;
      a = [(t1 + t2) | 0, a[0], a[1], a[2], (a[3] + t1) | 0, a[4], a[5], a[6]];
    }
    h = h.map(function (v, j) { return (v + a[j]) | 0; });
  }
  var out = [];
  h.forEach(function (v) { for (var j = 3; j >= 0; j--) out.push((v >>> (j * 8)) & 255); });
  return out;
}
function _hmacSha256(key, message) {
  var k = key.slice();
  if (k.length > 64) k = _sha256Bytes(k);
  while (k.length < 64) k.push(0);
  var inner = k.map(function (b) { return b ^ 54; });
  var outer = k.map(function (b) { return b ^ 92; });
  return _sha256Bytes(outer.concat(_sha256Bytes(inner.concat(message))));
}
function _hkdf(ikm, salt, info, length) {
  var prk = _hmacSha256(salt && salt.length ? salt : new Array(32).fill(0), ikm);
  var out = [], block = [], counter = 1;
  while (out.length < length) {
    block = _hmacSha256(prk, block.concat(info).concat([counter]));
    out = out.concat(block);
    counter++;
  }
  return out.slice(0, length);
}
var SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d];
function _xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 255; }
function _gmul(a, b) {
  var out = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) out ^= a;
    b >>= 1;
    a = _xtime(a);
  }
  return out & 255;
}
function _aesExpandKey(key) {
  var nk = key.length / 4, rounds = nk + 6, words = [], i;
  for (i = 0; i < nk; i++) words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  for (i = nk; i < 4 * (rounds + 1); i++) {
    var temp = words[i - 1].slice();
    if (i % nk === 0) temp = [SBOX[temp[1]] ^ RCON[i / nk - 1], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
    else if (nk > 6 && i % nk === 4) temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
    words.push([words[i - nk][0] ^ temp[0], words[i - nk][1] ^ temp[1], words[i - nk][2] ^ temp[2], words[i - nk][3] ^ temp[3]]);
  }
  return { words: words, rounds: rounds };
}
function _aesEncryptBlock(expanded, block) {
  var words = expanded.words, rounds = expanded.rounds, state = block.slice(), i, c, r;
  function addRoundKey(round) {
    for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) state[4 * c + r] ^= words[round * 4 + c][r];
  }
  addRoundKey(0);
  for (var round = 1; round <= rounds; round++) {
    for (i = 0; i < 16; i++) state[i] = SBOX[state[i]];
    var tmp = state.slice();
    for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) state[4 * c + r] = tmp[4 * ((c + r) % 4) + r];
    if (round !== rounds) {
      for (c = 0; c < 4; c++) {
        var a0 = state[4 * c], a1 = state[4 * c + 1], a2 = state[4 * c + 2], a3 = state[4 * c + 3];
        state[4 * c] = _gmul(a0, 2) ^ _gmul(a1, 3) ^ a2 ^ a3;
        state[4 * c + 1] = a0 ^ _gmul(a1, 2) ^ _gmul(a2, 3) ^ a3;
        state[4 * c + 2] = a0 ^ a1 ^ _gmul(a2, 2) ^ _gmul(a3, 3);
        state[4 * c + 3] = _gmul(a0, 3) ^ a1 ^ a2 ^ _gmul(a3, 2);
      }
    }
    addRoundKey(round);
  }
  return state;
}
function _ghashMul(x, y) {
  var z = new Array(16).fill(0), v = y.slice(), i, j;
  for (i = 0; i < 128; i++) {
    if ((x[i >> 3] & (1 << (7 - (i & 7)))) !== 0) for (j = 0; j < 16; j++) z[j] ^= v[j];
    var lsb = v[15] & 1;
    for (j = 15; j > 0; j--) v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 255;
    v[0] = (v[0] >> 1) & 255;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}
function _pad16(data) {
  var out = data.slice();
  while (out.length % 16 !== 0) out.push(0);
  return out;
}
function _gcmDecrypt(key, iv, data) {
  var expanded = _aesExpandKey(key);
  var h = _aesEncryptBlock(expanded, new Array(16).fill(0));
  var cipher = data.slice(0, data.length - 16);
  var tag = data.slice(data.length - 16);
  var j0 = iv.slice(0, 12).concat([0, 0, 0, 1]);
  function counterBlock(base, n) {
    var out = base.slice();
    for (var i = 15; i >= 12; i--) { out[i] = (out[i] + n) & 255; if (out[i] !== 0) break; }
    return out;
  }
  var counter = 1, plain = new Array(cipher.length);
  for (var offset = 0; offset < cipher.length; offset += 16) {
    var stream = _aesEncryptBlock(expanded, counterBlock(j0, counter));
    for (var i = 0; i < 16 && offset + i < cipher.length; i++) plain[offset + i] = cipher[offset + i] ^ stream[i];
    counter++;
  }
  var computed = _gcmTag(expanded, h, iv, cipher);
  var ok = true;
  for (var t = 0; t < 16; t++) if (computed[t] !== tag[t]) ok = false;
  return { plain: plain, tag: tag, ok: ok };
}
function _gcmTag(expanded, h, iv, cipher) {
  var j0 = iv.slice(0, 12).concat([0, 0, 0, 1]);
  var macInput = _pad16(cipher);
  var lenBlock = new Array(16).fill(0);
  var bits = cipher.length * 8;
  for (var b = 0; b < 8; b++) lenBlock[15 - b] = Math.floor(bits / Math.pow(2, 8 * b)) & 255;
  macInput = macInput.concat(lenBlock);
  var y = new Array(16).fill(0);
  for (var mo = 0; mo < macInput.length; mo += 16) {
    var x = new Array(16);
    for (var k = 0; k < 16; k++) x[k] = y[k] ^ macInput[mo + k];
    y = _ghashMul(x, h);
  }
  var mask = _aesEncryptBlock(expanded, j0);
  var tag = [];
  for (var t = 0; t < 16; t++) tag.push(y[t] ^ mask[t]);
  return tag;
}
function _inflate(input) {
  var pos = 0, bitBuf = 0, bitCount = 0;
  function bits(n) {
    while (bitCount < n) {
      if (pos >= input.length) throw new Error('inflate: out of input');
      bitBuf |= input[pos++] << bitCount;
      bitCount += 8;
    }
    var value = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return value;
  }
  function huffman(lengths) {
    var maxLen = 0, i;
    for (i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
    var blCount = new Array(maxLen + 1).fill(0), nextCode = new Array(maxLen + 1).fill(0), code = 0;
    for (i = 0; i < lengths.length; i++) blCount[lengths[i]]++;
    blCount[0] = 0;
    for (i = 1; i <= maxLen; i++) { code = (code + blCount[i - 1]) << 1; nextCode[i] = code; }
    var map = {};
    for (i = 0; i < lengths.length; i++) {
      if (!lengths[i]) continue;
      var len = lengths[i], c = nextCode[len]++;
      map[len + ':' + c] = i;
    }
    return { map: map, maxLen: maxLen };
  }
  function decode(tree) {
    var code = 0, len = 0, bit;
    while (len < tree.maxLen) {
      bit = bits(1);
      code = (code << 1) | bit;
      len++;
      var found = tree.map[len + ':' + code];
      if (found !== undefined) return found;
    }
    throw new Error('inflate: bad huffman code');
  }
  var LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  function inflateBlock(litTree, distTree) {
    while (true) {
      var sym = decode(litTree);
      if (sym < 256) { out.push(sym); continue; }
      if (sym === 256) return;
      sym -= 257;
      var length = LENGTH_BASE[sym] + bits(LENGTH_EXTRA[sym]);
      var dsym = decode(distTree);
      var distance = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
      for (var j = 0; j < length; j++) out.push(out[out.length - distance]);
    }
  }
  var out = [], last = false;
  while (!last) {
    last = bits(1);
    var type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCount = 0;
      var len = input[pos] | (input[pos + 1] << 8);
      pos += 4;
      for (var i = 0; i < len; i++) out.push(input[pos++]);
    } else if (type === 1) {
      var litLengths = [], distLengths = [], i;
      for (i = 0; i < 144; i++) litLengths.push(8);
      for (; i < 256; i++) litLengths.push(9);
      for (; i < 280; i++) litLengths.push(7);
      for (; i < 288; i++) litLengths.push(8);
      for (i = 0; i < 30; i++) distLengths.push(5);
      inflateBlock(huffman(litLengths), huffman(distLengths));
    } else if (type === 2) {
      var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      var order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      var codeLengths = new Array(19).fill(0);
      for (var k = 0; k < hclen; k++) codeLengths[order[k]] = bits(3);
      var clTree = huffman(codeLengths);
      var lengths = [], index = 0;
      while (index < hlit + hdist) {
        var sym = decode(clTree);
        if (sym < 16) { lengths.push(sym); index++; }
        else if (sym === 16) { var prev = lengths[lengths.length - 1]; var repeat = 3 + bits(2); for (var r = 0; r < repeat; r++) { lengths.push(prev); index++; } }
        else if (sym === 17) { var repeat2 = 3 + bits(3); for (var r2 = 0; r2 < repeat2; r2++) { lengths.push(0); index++; } }
        else { var repeat3 = 11 + bits(7); for (var r3 = 0; r3 < repeat3; r3++) { lengths.push(0); index++; } }
      }
      inflateBlock(huffman(lengths.slice(0, hlit)), huffman(lengths.slice(hlit, hlit + hdist)));
    } else {
      throw new Error('inflate: bad block type');
    }
  }
  return out;
}
function _zlibInflate(bytes) {
  return _inflate(bytes.slice(2));
}
function _utf8(text) {
  var out = [], encoded = unescape(encodeURIComponent(String(text)));
  for (var i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
  return out;
}
function _utf8Decode(bytes) {
  var out = '', i = 0;
  while (i < bytes.length) {
    var b = bytes[i++] & 255;
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f)); continue; }
    if (b < 0xf0) { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)); continue; }
    var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    cp -= 0x10000;
    out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
  }
  return out;
}
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64url(bytes) {
  var out = '', i, a, b, c, n;
  for (i = 0; i < bytes.length; i += 3) {
    a = bytes[i]; b = i + 1 < bytes.length ? bytes[i + 1] : 0; c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(text) {
  var clean = String(text || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  var out = [], i, j, n, value, group, significant;
  for (i = 0; i < clean.length; i += 4) {
    group = clean.slice(i, i + 4);
    significant = 0;
    n = 0;
    for (j = 0; j < 4; j++) {
      var ch = group.charAt(j);
      if (!ch) { n = (n << 6); continue; }
      value = B64.indexOf(ch);
      if (value < 0) { n = (n << 6); continue; }
      significant++;
      n = (n << 6) | value;
    }
    out.push((n >> 16) & 255);
    if (significant > 2) out.push((n >> 8) & 255);
    if (significant > 3) out.push(n & 255);
  }
  return out;
}
function _randomBytes(count) {
  var out = new Array(count);
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      var fresh = crypto.getRandomValues(new Uint8Array(count));
      for (var i = 0; i < count; i++) out[i] = fresh[i];
      return out;
    }
  } catch (e) { /* fall through to Math.random */ }
  for (var j = 0; j < count; j++) out[j] = Math.floor(Math.random() * 256);
  return out;
}
function _sealKey() {
  var ikm = SEAL_IKM_B.map(function (value, index) { return value ^ SEAL_IKM_A[index]; });
  return _hkdf(ikm, [], _utf8('api-seal|v1'), 32);
}
// The API answers a sealed payload as binary. How that binary reaches a
// provider differs by host: some hand over raw bytes, some hand over the byte
// list, some hand over base64 text, and some hand over the raw text. The seal
// authenticates the answer, so every reading is tried and the one that
// verifies is the right one.
function _byteCandidates(body) {
  var out = [], seen = {};
  function add(bytes) {
    if (!bytes || !bytes.length) return;
    var key = bytes.length + ':' + bytes[0] + ':' + bytes[bytes.length - 1];
    if (seen[key]) return;
    seen[key] = 1;
    out.push(bytes);
  }
  if (body && typeof body.length === 'number' && typeof body !== 'string') {
    var direct = [];
    for (var i = 0; i < body.length; i++) direct.push(body[i] & 255);
    add(direct);
    return out;
  }
  var text = String(body == null ? '' : body);
  // Dart's List<int>.toString() form, e.g. "[10, 1, 2, 3]".
  if (/^\[\s*\d+(\s*,\s*\d+)*\s*\]$/.test(text)) {
    add(text.replace(/[\[\]\s]/g, '').split(',').filter(Boolean).map(Number));
  }
  // Raw bytes carried one per character.
  var latin1 = [];
  var plain = true;
  for (var j = 0; j < text.length; j++) {
    var code = text.charCodeAt(j);
    if (code > 255) plain = false;
    latin1.push(code & 255);
  }
  if (plain) add(latin1);
  // Base64 text.
  if (/^[A-Za-z0-9+/\-_\s]+={0,2}$/.test(text) && text.replace(/\s/g, '').length % 4 === 0) {
    add(_b64urlDecode(text.replace(/\s/g, '')));
  }
  return out;
}
function _openApiSeal(body) {
  var candidates = _byteCandidates(body);
  var key = _sealKey();
  for (var i = 0; i < candidates.length; i++) {
    var bytes = candidates[i];
    if (bytes.length < 30) continue;
    var result = _gcmDecrypt(key, bytes.slice(1, 13), bytes.slice(13));
    if (!result.ok) continue;
    return _zlibInflate(result.plain);
  }
  throw new Error('Gotaku: the API answer could not be opened (the host delivered it in a form this source cannot read)');
}
function _openPlayerSeal(text, salt) {
  var raw = _b64urlDecode(text);
  var key = _hkdf(PLAYER_KEY, salt, _utf8('manifest-resp|v1'), 32);
  var result = _gcmDecrypt(key, raw.slice(0, 12), raw.slice(12));
  if (!result.ok) throw new Error('Gotaku: the player answer failed its seal');
  return result.plain;
}
function _sealPlayerRequest(payload) {
  var iv = _randomBytes(12);
  var plain = _utf8(JSON.stringify(payload));
  var expanded = _aesExpandKey(PLAYER_KEY);
  var h = _aesEncryptBlock(expanded, new Array(16).fill(0));
  var j0 = iv.slice(0, 12).concat([0, 0, 0, 1]);
  var cipher = new Array(plain.length);
  var counter = 1;
  for (var offset = 0; offset < plain.length; offset += 16) {
    var block = j0.slice();
    for (var c = 0; c < counter; c++) {
      for (var i = 15; i >= 12; i--) { block[i] = (block[i] + 1) & 255; if (block[i] !== 0) break; }
    }
    var stream = _aesEncryptBlock(expanded, block);
    for (var j = 0; j < 16 && offset + j < plain.length; j++) cipher[offset + j] = plain[offset + j] ^ stream[j];
    counter++;
  }
  return _b64url(iv.concat(cipher).concat(_gcmTag(expanded, h, iv, cipher)));
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function _readBody(response) {
  var body = response && response.body;
  if (typeof body === 'string') return Promise.resolve(body);
  if (response && typeof response.text === 'function') {
    try { return Promise.resolve(response.text()); } catch (e) { /* fall through */ }
  }
  if (body && typeof body === 'object') return Promise.resolve(JSON.stringify(body));
  return Promise.resolve(String(body == null ? '' : body));
}
function _isTransient(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}
function _tryOrigin(origin, path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var attempt = 0;
  function run() {
    return fetch(origin + path, {
      headers: options.headers || { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: origin + '/' },
      timeoutMs: cfg.timeoutMs,
      browser: options.browser === true
    }).then(function (response) {
      var status = Number(response && response.status || 0);
      if (status && (status < 200 || status >= 300)) {
        return _readBody(response).then(function () {
          var error = new Error('Gotaku HTTP ' + status + ' for ' + path);
          error.status = status;
          error.transient = _isTransient(status);
          throw error;
        });
      }
      if (options.binary && response && typeof response.arrayBuffer === 'function') {
        return response.arrayBuffer().then(function (buffer) {
          return { body: Array.from(new Uint8Array(buffer)), status: status };
        }).catch(function () {
          return _readBody(response).then(function (body) { return { body: body, status: status }; });
        });
      }
      return _readBody(response).then(function (body) {
        return { body: body, status: status };
      });
    }).catch(function (error) {
      if (error && error.transient !== false && attempt < cfg.retries) {
        attempt += 1;
        return new Promise(function (resolve) { setTimeout(resolve, 250 * attempt); }).then(run);
      }
      throw error;
    });
  }
  return run();
}
function _getJson(path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var candidates = _candidates();
  var index = 0, failures = [];
  function next() {
    if (index >= candidates.length) {
      var error = new Error('Gotaku: every configured domain failed (' + (failures.join('; ') || 'no domain tried') + ')');
      error.diagnostics = failures;
      throw error;
    }
    var domain = candidates[index++];
    return _tryOrigin('https://' + domain, path, options).then(function (result) {
      _markHealthy(domain);
      try { return JSON.parse(String(result.body || '') || 'null'); }
      catch (e) {
        var bad = new Error('Gotaku: malformed answer from ' + domain);
        bad.transient = true;
        throw bad;
      }
    }).catch(function (error) {
      _markUnhealthy(domain);
      failures.push(domain + ': ' + String(error && error.message || error));
      if (!cfg.autoFallback) throw error;
      return next();
    });
  }
  return next();
}
function _getText(path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var candidates = _candidates();
  var index = 0, failures = [];
  function next() {
    if (index >= candidates.length) {
      var error = new Error('Gotaku: every configured domain failed (' + (failures.join('; ') || 'no domain tried') + ')');
      error.diagnostics = failures;
      throw error;
    }
    var domain = candidates[index++];
    return _tryOrigin('https://' + domain, path, options).then(function (result) {
      _markHealthy(domain);
      return String(result.body || '');
    }).catch(function (error) {
      _markUnhealthy(domain);
      failures.push(domain + ': ' + String(error && error.message || error));
      if (!cfg.autoFallback) throw error;
      return next();
    });
  }
  return next();
}
function _getBytes(path, opts) {
  var cfg = _settings();
  var options = opts || {};
  options.binary = true;
  var candidates = _candidates();
  var index = 0, failures = [];
  function next() {
    if (index >= candidates.length) {
      var error = new Error('Gotaku: every configured domain failed (' + (failures.join('; ') || 'no domain tried') + ')');
      error.diagnostics = failures;
      throw error;
    }
    var domain = candidates[index++];
    return _tryOrigin('https://' + domain, path, options).then(function (result) {
      _markHealthy(domain);
      return result.body;
    }).catch(function (error) {
      _markUnhealthy(domain);
      failures.push(domain + ': ' + String(error && error.message || error));
      if (!cfg.autoFallback) throw error;
      return next();
    });
  }
  return next();
}

var playerCookie = '';
function _getAbsolute(url, opts) {
  var cfg = _settings();
  var options = opts || {};
  var attempt = 0;
  function run() {
    var headers = options.headers || { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' };
    if (playerCookie && !headers.Cookie) headers = Object.assign({}, headers, { Cookie: playerCookie });
    return fetch(String(url), {
      headers: headers,
      timeoutMs: cfg.timeoutMs,
      browser: options.browser === true
    }).then(function (response) {
      var status = Number(response && response.status || 0);
      var setCookie = response && typeof response.headers === 'object' ? response.headers['set-cookie'] : null;
      if (setCookie) {
        var raw = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
        var match = raw.match(/session=[^;,\s]+/);
        if (match) playerCookie = match[0];
      }
      if (status && (status < 200 || status >= 300)) {
        var error = new Error('Gotaku player HTTP ' + status);
        error.status = status;
        error.transient = _isTransient(status);
        throw error;
      }
      if (options.binary && response && typeof response.arrayBuffer === 'function') {
        return response.arrayBuffer().then(function (buffer) {
          return { body: Array.from(new Uint8Array(buffer)), status: status };
        }).catch(function () {
          return _readBody(response).then(function (body) { return { body: body, status: status }; });
        });
      }
      return _readBody(response).then(function (body) { return { body: body, status: status }; });
    }).catch(function (error) {
      if (error && error.transient !== false && attempt < cfg.retries) {
        attempt += 1;
        return new Promise(function (resolve) { setTimeout(resolve, 250 * attempt); }).then(run);
      }
      throw error;
    });
  }
  return run();
}

// ── catalogue ────────────────────────────────────────────────────────────────
function _absolute(value, base) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.indexOf('//') === 0) return 'https:' + text;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.charAt(0) === '/') return String(base || 'https://' + OFFICIAL_DOMAIN) + text;
  return '';
}
function _num(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? n : null;
}
function _itemUrl(id) {
  return 'gotaku://title/' + encodeURIComponent(String(id));
}
function _card(row) {
  if (!row || !row.id || !row.name) return null;
  if (row.is_adult === true) return null;
  var cover = _absolute(row.poster_url, 'https://' + OFFICIAL_DOMAIN);
  return {
    id: _itemUrl(row.id),
    url: _itemUrl(row.id),
    title: String(row.name),
    name: String(row.name),
    cover: cover || null,
    poster: cover || null,
    banner: _absolute(row.banner_url, 'https://' + OFFICIAL_DOMAIN) || null,
    type: 'anime',
    sourceId: SOURCE_ID,
    year: row.year ? String(row.year) : null,
    score: typeof row.score === 'number' ? Math.round(row.score * 10) : null,
    genres: Array.isArray(row.genres) ? row.genres.map(function (g) { return g && g.name ? g.name : String(g); }) : [],
    anilistId: _num(row.anilist_id),
    malId: row.links && row.links.mal ? (_num(String(row.links.mal).match(/(\d+)$/)?.[1])) : null
  };
}
function _cards(payload) {
  var rows = payload && Array.isArray(payload.data) ? payload.data : [];
  var out = [], seen = {};
  rows.forEach(function (row) {
    var card = _card(row);
    if (!card || seen[card.id]) return;
    seen[card.id] = 1;
    out.push(card);
  });
  return out;
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var current = Math.max(1, _int(page, 1, 1, 25));
  var path = API_PATH + '/titles?q=' + encodeURIComponent(q) + '&page=' + current + '&limit=25';
  return _getJson(path).then(_cards).catch(function () { return []; });
}
function popular(opts) {
  var path = API_PATH + '/titles?page=1&limit=24';
  return _getJson(path).then(_cards).catch(function () { return []; });
}
function getHome(opts) {
  var schedule = API_PATH + '/schedule';
  var recent = API_PATH + '/titles?page=1&limit=24';
  return Promise.all([
    _getJson(schedule).then(function (payload) {
      var rows = payload && Array.isArray(payload.data) ? payload.data : [];
      var out = [], seen = {};
      rows.forEach(function (row) {
        var title = row && row.title;
        if (!title || !title.id) return;
        var card = _card(title);
        if (!card || seen[card.id]) return;
        seen[card.id] = 1;
        card.episodeLabel = row.episode_label || row.episode || null;
        out.push(card);
      });
      return out;
    }).catch(function () { return []; }),
    _getJson(recent).then(_cards).catch(function () { return []; })
  ]).then(function (results) {
    var rows = [];
    if (results[0].length) rows.push({ title: 'Latest episodes on Gotaku', items: results[0].slice(0, 24) });
    if (results[1].length) rows.push({ title: 'Popular on Gotaku', items: results[1].slice(0, 24) });
    if (rows.length) return rows;
    return popular(opts).then(function (items) { return items.length ? [{ title: 'Anime on Gotaku', items: items }] : []; });
  });
}
function _parseItem(url) {
  var text = String(url == null ? '' : url);
  var match = text.match(/^gotaku:\/\/title\/([^/?#]+)/i);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
}
function _episodeUrl(titleId, episodeId, track) {
  return 'gotaku://episode/' + encodeURIComponent(String(titleId)) + '/' + encodeURIComponent(String(episodeId)) + '/' + track;
}
function _episodeRows(payload) {
  var rows = payload && Array.isArray(payload.data) ? payload.data : [];
  var out = [], seen = {};
  rows.forEach(function (row) {
    if (!row || !row.id) return;
    var number = _num(row.number) || out.length + 1;
    if (seen[row.id]) return;
    seen[row.id] = 1;
    out.push({
      id: row.id,
      number: number,
      label: row.label || null,
      title: row.name || ('Episode ' + number),
      thumbnail: row.thumbnail_url || null,
      airedAt: row.aired_at || null,
      sub: row.sub === true,
      dub: row.dub === true,
      filler: row.is_filler === true,
      canon: row.is_canon === true
    });
  });
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
// The app asks for one track per episode through opts.category and counts the
// rows it gets, so an episode is listed once. The provider's own preference
// only decides the track when the app does not ask for one.
function _wantedTrack(opts) {
  var asked = opts && opts.category ? String(opts.category).toLowerCase() : '';
  if (asked === 'dub' || asked === 'dubbed') return 'dub';
  if (asked === 'sub' || asked === 'subbed') return 'sub';
  var cfg = _settings();
  if (cfg.audio === 'dub') return 'dub';
  if (cfg.audio === 'sub') return 'sub';
  return cfg.audioLanguage === 'en' ? 'dub' : 'sub';
}
function _episodeTrack(row, wanted) {
  if (wanted === 'dub') return row.dub ? 'dub' : (row.sub ? 'sub' : null);
  return row.sub ? 'sub' : (row.dub ? 'dub' : null);
}
function _episodes(titleId, rows, opts) {
  var wanted = _wantedTrack(opts);
  var out = [];
  rows.forEach(function (row) {
    var track = _episodeTrack(row, wanted);
    if (!track) return;
    var url = _episodeUrl(titleId, row.id, track);
    out.push({
      id: url,
      url: url,
      number: row.number,
      title: 'Episode ' + row.number + (row.label && row.label !== String(row.number) ? ': ' + row.title : ''),
      date: row.airedAt ? String(row.airedAt).slice(0, 10) : null,
      thumbnail: row.thumbnail || null,
      category: track,
      kind: track,
      sourceId: SOURCE_ID,
      type: 'anime'
    });
  });
  return out;
}
function getDetail(url, opts) {
  var id = _parseItem(url);
  if (!id) return Promise.reject(new Error('Gotaku: unknown title reference'));
  var titlePath = API_PATH + '/titles/' + encodeURIComponent(id);
  var episodesPath = API_PATH + '/titles/' + encodeURIComponent(id) + '/episodes?k=' + API_VERSION;
  var failures = [];
  return Promise.all([
    _getJson(titlePath).catch(function (error) { failures.push(error); return null; }),
    // The API returns a sealed binary payload. The app decodes responses
    // as UTF-8 text by default, which corrupts the binary. The seal
    // authenticates it, so we try every reading of the corrupted text
    // and keep the one that verifies.
    _getBytes(episodesPath, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' } }).then(function (body) {
      return _openApiSeal(body);
    }).catch(function (error) { failures.push(error); return null; })
  ]).then(function (results) {
    var payload = results[0] && results[0].data ? results[0].data : null;
    var title = payload && payload.title ? payload.title : null;
    var rows = results[1] ? _episodeRows(JSON.parse(_utf8Decode(results[1]))) : [];
    if (!title && !rows.length) {
      if (failures.length) throw failures[0];
      throw new Error('Gotaku: title not found');
    }
    var card = _card(title || { id: id, name: id }) || { id: _itemUrl(id), url: _itemUrl(id), title: id, type: 'anime', sourceId: SOURCE_ID };
    card.url = _itemUrl(id);
    card.id = _itemUrl(id);
    if (title) {
      card.description = title.synopsis || '';
      card.genres = Array.isArray(title.genres) ? title.genres.map(function (g) { return g && g.name ? g.name : String(g); }) : [];
      card.themes = Array.isArray(title.themes) ? title.themes.map(function (g) { return g && g.name ? g.name : String(g); }) : [];
      card.studios = Array.isArray(title.studios) ? title.studios.map(function (g) { return g && g.name ? g.name : String(g); }) : [];
      card.status = title.status ? String(title.status).toLowerCase() : 'unknown';
      card.format = title.format || null;
      card.season = title.season || null;
      card.aired = title.aired || null;
      card.rating = title.age_rating || null;
      card.country = title.country || null;
      card.source = title.source || null;
      card.nativeTitle = title.alt_names && title.alt_names.length ? String(title.alt_names[0]) : null;
      card.altTitles = Array.isArray(title.alt_names) ? title.alt_names.slice(0) : [];
      card.anilistId = _num(title.anilist_id) || card.anilistId || null;
      card.malId = title.links && title.links.mal ? (_num(String(title.links.mal).match(/(\d+)$/)?.[1])) : card.malId || null;
      card.seasons = Array.isArray(payload.seasons) ? payload.seasons.map(function (s) { return { id: s.id, name: s.name, fullName: s.full_name, current: s.is_current === true }; }) : [];
      card.relations = Array.isArray(payload.relations) ? payload.relations.map(function (r) { return { id: r.id, name: r.name, relation: r.relation, type: r.relation_type }; }) : [];
    }
    if (!rows.length) throw new Error('Gotaku: Gotaku lists no episodes for this title');
    card.episodes = _episodes(id, rows, opts);
    card.episodeCount = rows.length;
    card.subCount = rows.filter(function (r) { return r.sub; }).length;
    card.dubCount = rows.filter(function (r) { return r.dub; }).length;
    return card;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; }).catch(function () { return []; });
}
function _byteArray(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') {
    var out = new Array(body.length);
    for (var i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 255;
    return out;
  }
  if (body && typeof body === 'object') {
    if (typeof body.length === 'number') {
      var bytes = new Array(body.length);
      for (var j = 0; j < body.length; j++) bytes[j] = body[j] & 255;
      return bytes;
    }
  }
  return [];
}
function _parseEpisode(value) {
  var text = String(value == null ? '' : value);
  var match = text.match(/^gotaku:\/\/episode\/([^/?#]+)\/([^/?#]+)\/(sub|dub)$/i);
  if (!match) return null;
  var titleId, episodeId;
  try { titleId = decodeURIComponent(match[1]); } catch (e) { titleId = match[1]; }
  try { episodeId = decodeURIComponent(match[2]); } catch (e) { episodeId = match[2]; }
  return { titleId: titleId, episodeId: episodeId, track: match[3].toLowerCase() };
}
function _embedPath(episode, track) {
  return API_PATH + '/episodes/' + encodeURIComponent(episode.episodeId) + '/embed?type=' + encodeURIComponent(track) + '&k=' + API_VERSION;
}
function _playerAttrs(html) {
  var attrs = {};
  var pattern = /data-([a-z-]+)="([^"]*)"/g, match;
  while ((match = pattern.exec(String(html || ''))) !== null) attrs[match[1]] = match[2];
  return attrs;
}
// Playback: the episode's embed descriptor names the player page; the player
// page carries the stamp; the request is sealed with the same key the player
// uses and the answer is sealed with a key derived from the nonce that was
// sent. The result is the site's own playback entry point.
function _resolveStream(episode, track) {
  var embedPath = _embedPath(episode, track);
  return _getBytes(embedPath, { binary: true, headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' } }).then(function (body) {
    var descriptor = JSON.parse(_utf8Decode(_openApiSeal(_byteArray(body))));
    var embedUrl = descriptor && descriptor.data ? descriptor.data.url : null;
    if (!embedUrl || !/^https?:\/\//i.test(String(embedUrl))) throw new Error('Gotaku: the episode carried no player page');
    return _getAbsolute(embedUrl + '?autoplay=true', { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://' + OFFICIAL_DOMAIN + '/' } }).then(function (result) {
      var html = String(result.body || '');
      var attrs = _playerAttrs(html);
      var base = attrs['manifest-base'];
      var stamp = attrs['manifest-stamp'];
      if (!base || !stamp) throw new Error('Gotaku: the player page carried no manifest stamp');
      var nonceBytes = _randomBytes(16);
      var nonce = _b64url(nonceBytes);
      var token = _sealPlayerRequest({ nonce: nonce, stamp: stamp });
      var manifestUrl = base + '/' + token;
      return _getAbsolute(manifestUrl, { headers: { 'User-Agent': UA, Accept: 'text/plain', Referer: embedUrl } }).then(function (result) {
        var session = JSON.parse(_utf8Decode(_openPlayerSeal(String(result.body || ''), nonceBytes)));
        if (!session || !session.source) throw new Error('Gotaku: the player returned no playback source');
        var headers = { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': 'https://' + OFFICIAL_DOMAIN };
        var streams = [];
        streams.push({
          url: session.source,
          quality: 'Auto',
          label: 'Gotaku ' + track.toUpperCase(),
          container: 'hls',
          headers: headers,
          kind: track === 'dub' ? 'dub' : 'sub',
          audio: track === 'dub' ? 'en' : 'ja',
          audioLang: track === 'dub' ? 'en' : 'ja',
          subtitles: [],
          isActive: true
        });
        // The fallback hosts carry the same path on the primary CDN, so each one
        // becomes a real media URL rather than a bare origin.
        var sourcePath = String(session.source).replace(/^https?:\/\/[^/]+/i, '');
        (Array.isArray(session.fallbacks) ? session.fallbacks : []).forEach(function (host) {
          if (!/^https?:\/\//i.test(String(host))) return;
          streams.push({
            url: String(host).replace(/\/+$/, '') + sourcePath,
            quality: 'Auto',
            label: 'Gotaku ' + track.toUpperCase() + ' · fallback',
            container: 'hls',
            headers: headers,
            kind: track === 'dub' ? 'dub' : 'sub',
            audio: track === 'dub' ? 'en' : 'ja',
            audioLang: track === 'dub' ? 'en' : 'ja',
            subtitles: [],
            isActive: false
          });
        });
        return streams;
      });
    });
  });
}
function getVideoSources(episodeUrl, opts) {
  var episode = _parseEpisode(episodeUrl);
  if (!episode) return Promise.resolve([]);
  var cfg = _settings();
  var tracks = [episode.track];
  if (cfg.audio === 'both') tracks.push(episode.track === 'sub' ? 'dub' : 'sub');
  function attempt(index) {
    if (index >= tracks.length) return Promise.resolve([]);
    return _resolveStream(episode, tracks[index]).catch(function (error) {
      console.warn('Gotaku: no stream for episode ' + episode.episodeId + ' (' + tracks[index] + '): ' + String(error && error.message || error));
      return attempt(index + 1);
    });
  }
  return attempt(0).catch(function () { return []; });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _settings: _settings, _normaliseDomain: _normaliseDomain, _domainList: _domainList,
    _candidates: _candidates, _card: _card, _episodeRows: _episodeRows, _episodes: _episodes,
    _parseItem: _parseItem, _parseEpisode: _parseEpisode, _playerAttrs: _playerAttrs,
    _sealKey: _sealKey, _openApiSeal: _openApiSeal, _openPlayerSeal: _openPlayerSeal,
    _sealPlayerRequest: _sealPlayerRequest, _b64url: _b64url, _b64urlDecode: _b64urlDecode,
    _sha256Bytes: _sha256Bytes, _hkdf: _hkdf, _gcmDecrypt: _gcmDecrypt, _inflate: _inflate,
    _utf8: _utf8, _utf8Decode: _utf8Decode, _gcmTag: _gcmTag, _sealPlayerRequest: _sealPlayerRequest
  };
}
