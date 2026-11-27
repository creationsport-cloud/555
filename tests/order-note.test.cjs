const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/kitchen-pin/index.ts', 'utf8');
const schema = fs.readFileSync('schema.sql', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261127094834_add_order_note.sql', 'utf8');

assert.match(html, /id="order-note" maxlength="500"/);
assert.match(app, /kitchenRequest\('place-order',\{items:chosen,fulfillmentType,note:orderNote\}\)/);
assert.match(app, /note:row\.note\|\|""/);
assert.match(app, /escapeHtml\(o\.note\)/);
assert.match(app, /escapeHtml\(orderNote\)/);
assert.match(app, /data\.note\?\['หมายเหตุ: '\+data\.note\]:\[\]/);
assert.match(edge, /normalizeOrderNote\(body\.note\)/);
assert.match(edge, /fulfillment_type: body\.fulfillmentType, note/);
assert.match(schema, /note text not null default '' check \(char_length\(note\) <= 500\)/);
assert.match(migration, /add column if not exists note text not null default ''/);
assert.match(migration, /char_length\(note\) <= 500/);

const helper = edge.match(/function normalizeOrderNote\(value: unknown\): string \| null \{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, 'server-side note validation helper exists');
const executable = helper.replace('function normalizeOrderNote(value: unknown): string | null {', 'function normalizeOrderNote(value) {');
const context = {};
vm.runInNewContext(executable + ';globalThis.normalizeOrderNote=normalizeOrderNote', context);
assert.equal(context.normalizeOrderNote(undefined), '');
assert.equal(context.normalizeOrderNote('  ไม่ใส่ผัก  '), 'ไม่ใส่ผัก');
assert.equal(context.normalizeOrderNote('ก'.repeat(500)), 'ก'.repeat(500));
assert.equal(context.normalizeOrderNote('ก'.repeat(501)), null);
assert.equal(context.normalizeOrderNote(123), null);

console.log('Order note tests passed');

