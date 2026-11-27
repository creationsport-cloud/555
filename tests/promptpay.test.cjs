const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const helpers = app.slice(app.indexOf('function normalizePromptPayId'), app.indexOf('function paymentBadge'));
const context = {};
vm.runInNewContext(`${helpers};globalThis.api={normalizePromptPayId,promptPayPayload,crc16}`, context);

const { normalizePromptPayId, promptPayPayload, crc16 } = context.api;
assert.deepEqual(JSON.parse(JSON.stringify(normalizePromptPayId('080-219-6458'))), { tag: '01', value: '0066802196458' });
assert.equal(normalizePromptPayId('1234567890123').tag, '02');
assert.equal(normalizePromptPayId('123456789012345').tag, '03');

const payload = promptPayPayload('0802196458', 123.45);
assert.ok(payload.includes('5406123.45'), 'QR payload includes the exact order amount');
assert.ok(payload.includes('01130066802196458'), 'QR payload contains the normalized mobile PromptPay ID');
assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)), 'QR payload CRC matches');
assert.throws(() => promptPayPayload('', 100), /PromptPay/);
assert.throws(() => promptPayPayload('0802196458', 0), /ยอดชำระ/);

console.log('PromptPay payload tests passed');
