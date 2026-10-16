'use strict';
const assert = require('assert');
const provider = require('../providers/anipm.js');

assert.strictEqual(provider.version, '1.0.0');
assert.deepStrictEqual(provider.getInfo().name, 'Ani.pm');
assert.strictEqual(provider.getInfo().type, 'anime');
assert.strictEqual(provider.getSettings()[0].key, 'language');
assert.strictEqual(provider.getSettings()[0].default, 'sub');
console.log('Ani.pm provider smoke tests passed');
