const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const edgeFunction = fs.readFileSync('supabase/functions/kitchen-pin/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261127010000_add_order_fulfillment_type.sql', 'utf8');

assert.match(html, /class="fulfillment-options" role="group"/);
assert.match(html, /data-fulfillment-type="dine_in"[^>]*>ทานที่ร้าน/);
assert.match(html, /data-fulfillment-type="takeaway"[^>]*>กลับบ้าน/);
assert.doesNotMatch(html, /<select id="fulfillment-type"/);
assert.match(app, /disabled=!count\|\|!fulfillmentChoice\|\|publicSetupMissing/);
assert.match(app, /option\.classList\.toggle\('selected',selected\)/);
assert.match(app, /kitchenRequest\('place-order',\{items:chosen,fulfillmentType\}\)/);
assert.match(app, /fulfillmentType:row\.fulfillment_type\|\|null/);
assert.match(app, /fulfillmentLabel\(o\.fulfillmentType\)/);
assert.match(app, /<div class="fulfillment-badge">\$\{escapeHtml\(fulfillmentLabel\(o\.fulfillmentType\)\)\}<\/div>/);
assert.match(app, /function speakKitchenOrder\(order\)/);
assert.match(app, /new window\.SpeechSynthesisUtterance/);
assert.match(app, /incoming\.forEach\(speakKitchenOrder\)/);
assert.match(app, /order\.items\.map\(item=>item\.name\+' '\+item\.qty\+' '\+unit\)/);

const speechStart = app.indexOf('function updateThaiSpeechStatus()');
const speechEnd = app.indexOf('\nasync function pullOrders', speechStart);
assert.notEqual(speechStart, -1);
assert.notEqual(speechEnd, -1);
const spoken = [];
class Speech {
  constructor(text) { this.text = text; }
}
const speechContext = {
  kitchenSoundEnabled: true,
  window: {
    SpeechSynthesisUtterance: Speech,
    speechSynthesis: {
      getVoices: () => [{ lang: 'th-TH' }],
      speak: utterance => spoken.push(utterance)
    }
  },
  document: { querySelector: () => ({ textContent: '', classList: { toggle() {} } }) }
};
vm.runInNewContext(app.slice(speechStart, speechEnd), speechContext);
speechContext.speakKitchenOrder({
  number: '0047',
  fulfillmentType: 'takeaway',
  items: [{ name: 'ข้าวผัดไก่', qty: 1 }]
});
assert.equal(spoken[0].text, 'ออร์เดอร์ใหม่ หมายเลข 0047 ข้าวผัดไก่ 1 กล่อง');
assert.equal(spoken[0].lang, 'th-TH');
assert.equal(spoken[0].voice.lang, 'th-TH');
let missingVoiceMessage = '';
const noThaiVoiceContext = {
  kitchenSoundEnabled: true,
  window: {
    SpeechSynthesisUtterance: Speech,
    speechSynthesis: { getVoices: () => [], speak: utterance => spoken.push(utterance) }
  },
  document: { querySelector: () => ({ set textContent(value) { missingVoiceMessage = value; }, classList: { toggle() {} } }) }
};
vm.runInNewContext(app.slice(speechStart, speechEnd), noThaiVoiceContext);
noThaiVoiceContext.speakKitchenOrder({ number: '0048', fulfillmentType: 'dine_in', items: [{ name: 'ข้าวผัดไก่', qty: 1 }] });
assert.equal(spoken.length, 1, 'do not read Thai text with a non-Thai fallback voice');
assert.match(missingVoiceMessage, /ไม่พบเสียงภาษาไทย/);
assert.match(edgeFunction, /body\.fulfillmentType !== "dine_in" && body\.fulfillmentType !== "takeaway"/);
assert.match(edgeFunction, /fulfillment_type: body\.fulfillmentType/);
assert.match(migration, /fulfillment_type in \('dine_in', 'takeaway'\)/);

console.log('Fulfillment choice tests passed');

