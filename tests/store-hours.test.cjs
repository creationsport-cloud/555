const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
assert.match(html, /id="closing-countdown"[^>]*role="timer"/);
assert.match(app, /timeZone:'Asia\/Bangkok'/);
assert.match(app, /22\*3600-seconds/);

const start = app.indexOf('function updateClosingCountdown(now=new Date())');
const end = app.indexOf('\nfunction showCategories', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const display = { textContent: '', classList: { add() {}, remove() {} } };
const context = { document: { querySelector: () => display }, setInterval() {} };
vm.runInNewContext(app.slice(start, end), context);

context.updateClosingCountdown(new Date('2026-11-27T14:59:58Z'));
assert.equal(display.textContent, 'ปิดร้านใน 00:00:02');
context.updateClosingCountdown(new Date('2026-11-27T15:00:00Z'));
assert.equal(display.textContent, 'ปิดร้านแล้ววันนี้');
context.updateClosingCountdown(new Date('2026-11-28T13:00:00Z'));
assert.equal(display.textContent, 'ปิดร้านใน 02:00:00');

console.log('Store closing countdown tests passed');

