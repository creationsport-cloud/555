const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const start = app.indexOf('const paymentQrImage=');
const end = app.indexOf('function paymentBadge', start);
assert.notEqual(start, -1, 'TrueMoney payment helpers are present');
assert.notEqual(end, -1, 'payment badge helper follows the testable functions');
const helpers = app.slice(start, end);

const classes = new Set(['hidden']);
const container = {
  children: [],
  classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
  replaceChildren(...children) { this.children = children; }
};
const instructions = { textContent: '' };
const image = { src: '', alt: '', onerror: null };
const context = {
  document: {
    querySelector(selector) {
      if (selector === '#payment-qr') return container;
      if (selector === '#payment-instructions') return instructions;
      throw new Error('Unexpected selector ' + selector);
    },
    createElement(tag) {
      assert.equal(tag, 'img');
      return image;
    }
  }
};
vm.runInNewContext("const money=n=>'฿'+n.toLocaleString('th-TH');" + helpers + ";globalThis.api={paymentQrImage,paymentInstructions,renderPaymentQr}", context);
const { paymentQrImage, paymentInstructions, renderPaymentQr } = context.api;

assert.equal(paymentQrImage, 'truemoney-merchant-qr.jpg');
assert.ok(fs.existsSync(paymentQrImage), 'provided merchant QR image is bundled');
assert.equal(paymentInstructions(123.45), 'เปิดแอป TrueMoney สแกน QR แล้วกรอกยอด ฿123.45 ตรวจสอบชื่อผู้รับก่อนกดยืนยันชำระเงิน');

renderPaymentQr();
assert.equal(image.src, paymentQrImage);
assert.equal(image.alt, 'QR รับชำระเงินด้วย TrueMoney');
assert.equal(container.children[0], image);
assert.ok(!classes.has('hidden'), 'payment QR container is shown');

image.onerror();
assert.ok(classes.has('hidden'), 'QR area is hidden if the image cannot load');
assert.match(instructions.textContent, /TrueMoney/);

assert.ok(!app.includes('promptPayPayload'), 'PromptPay payload generation has been removed');
assert.ok(!app.includes('config.promptPayId'), 'old PromptPay destination is no longer used');

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('app.js?v=19'), 'browser cache is bumped for the latest checkout change');
assert.ok(!html.includes('qrcode.min.js'), 'unused external QR generator is removed');

console.log('TrueMoney checkout tests passed');
