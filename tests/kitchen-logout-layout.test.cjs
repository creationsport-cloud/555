const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const content = html.match(/<div id="kitchen-content"[^>]*>([\s\S]*?)<\/div><\/section>/)?.[1] || '';
assert.ok(content, 'kitchen content exists');
assert.ok(content.indexOf('id="clear-orders"') < content.indexOf('id="kitchen-tabs"') || content.indexOf('class="kitchen-tabs"') < content.indexOf('id="staff-logout"'));
assert.ok(content.indexOf('class="kitchen-menu-panel"') < content.indexOf('id="staff-logout"') || content.indexOf('id="staff-logout"') > content.indexOf('id="kitchen-menu-panel"'));
assert.match(content, /id="staff-logout" class="light kitchen-logout" type="button">ออกจากระบบ/);
assert.match(css, /\.kitchen-logout\{display:block;margin:22px 0 0 auto\}/);
const toolbar = html.match(/<div class="kitchen-toolbar">([\s\S]*?)<\/div>/)?.[1] || '';
assert.ok(!toolbar.includes('id="staff-logout"'), 'logout is removed from the toolbar');
assert.match(html, /style\.css\?v=\d+/);

console.log('Kitchen logout layout tests passed');

