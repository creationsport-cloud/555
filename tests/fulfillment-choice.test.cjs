const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const edgeFunction = fs.readFileSync('supabase/functions/kitchen-pin/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261127010000_add_order_fulfillment_type.sql', 'utf8');

assert.match(html, /<select id="fulfillment-type" required>/);
assert.match(html, /value="dine_in">ทานที่ร้าน/);
assert.match(html, /value="takeaway">กลับบ้าน/);
assert.match(app, /disabled=!count\|\|!fulfillmentType\|\|publicSetupMissing/);
assert.match(app, /kitchenRequest\('place-order',\{items:chosen,fulfillmentType\}\)/);
assert.match(app, /fulfillmentType:row\.fulfillment_type\|\|null/);
assert.match(app, /fulfillmentLabel\(o\.fulfillmentType\)/);
assert.match(edgeFunction, /body\.fulfillmentType !== "dine_in" && body\.fulfillmentType !== "takeaway"/);
assert.match(edgeFunction, /fulfillment_type: body\.fulfillmentType/);
assert.match(migration, /fulfillment_type in \('dine_in', 'takeaway'\)/);

console.log('Fulfillment choice tests passed');
