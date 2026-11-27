const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/kitchen-pin/index.ts', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');

assert.match(app, /data-extra-type="\$\{extra\.id\}"[^>]*data-extra-step="1"/);
assert.match(app, /ไข่ดาว/);
assert.match(app, /ไข่เจียว/);
assert.match(app, /cartExtras\[id\]\[type\]=Math\.max/);
assert.match(app, /items:chosen/);
assert.match(app, /extras:cartExtras\[id\]\|\|\{\}/);
assert.match(app, /item\.price\*item\.qty\+item\.extras\.reduce/);
assert.match(app, /item\.extras\?\.length/);
assert.match(app, /order-item-extras/);
assert.match(app, /receipt-extras/);
assert.match(app, /extra\.name\+' '\+extra\.qty\+' ฟอง'/);
assert.match(app, /extra\.name\} × \$\{extra\.qty\} = \$\{money\(extra\.price\*extra\.qty\)\}/);
assert.match(css, /\.cart-addons\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(html, /app\.js\?v=27/);

const totalFn = app.match(/function cartAddOnTotal\(extras=\{\}\)\{[\s\S]*?\}/)?.[0];
assert.ok(totalFn, 'add-on total helper exists');
const cartContext = { cartAddOns: [{ id: 'fried_egg' }, { id: 'omelet' }] };
vm.runInNewContext(totalFn + ';globalThis.cartAddOnTotal=cartAddOnTotal', cartContext);
assert.equal(cartContext.cartAddOnTotal({ fried_egg: 1 }), 10);
assert.equal(cartContext.cartAddOnTotal({ fried_egg: 1, omelet: 2 }), 30);
assert.equal(cartContext.cartAddOnTotal({}), 0);

const catalog = edge.match(/const ORDER_ADD_ONS = \{[\s\S]*?\n\};/)?.[0];
const helper = edge.match(/function normalizeOrderAddOns\(value: unknown\): \{ name: string; price: number; qty: number \}\[\] \| null \{[\s\S]*?\n\}/)?.[0];
assert.ok(catalog && helper, 'server-side egg add-on catalog and validator exist');
const edgeContext = {};
const executableHelper = helper
  .replace('function normalizeOrderAddOns(value: unknown): { name: string; price: number; qty: number }[] | null {', 'function normalizeOrderAddOns(value) {')
  .replace('const counts = value as Record<string, unknown>;', 'const counts = value;')
  .replace('const extras: { name: string; price: number; qty: number }[] = [];', 'const extras = [];');
vm.runInNewContext(catalog + '\n' + executableHelper + ';globalThis.normalizeOrderAddOns=normalizeOrderAddOns', edgeContext);
const normalize = value => JSON.parse(JSON.stringify(edgeContext.normalizeOrderAddOns(value)));
assert.deepEqual(normalize(undefined), []);
assert.deepEqual(normalize({ fried_egg: 1 }), [{ name: 'ไข่ดาว', price: 10, qty: 1 }]);
assert.deepEqual(normalize({ omelet: 2 }), [{ name: 'ไข่เจียว', price: 10, qty: 2 }]);
assert.equal(edgeContext.normalizeOrderAddOns({ fried_egg: 51 }), null);
assert.equal(edgeContext.normalizeOrderAddOns({ fried_egg: '1' }), null);
assert.equal(edgeContext.normalizeOrderAddOns({ other: 1 }), null);
assert.match(edge, /item\.extras\.reduce\(\(extraSum, extra\) => extraSum \+ extra\.price \* extra\.qty, 0\)/);

console.log('Order add-on tests passed');

