import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = path => fs.readFile(path, 'utf8');

async function importBrowserModule(path) {
  const source = await read(path);
  globalThis.window = globalThis.window || {};
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(`${url}#${Date.now()}-${Math.random()}`);
}

test('salvageChatMessages preserves special message types', async () => {
  const { salvageChatMessages } = await importBrowserModule('jsonFilter.js');
  const malformed = `{
    "messages": [
      {"type":"image","description":"海边照片"},
      {"type":"transfer","amount":88.5,"note":"早餐钱"},
      {"type":"schedule","title":"复习","startTime":"2026-07-31 08:00"}
    ]
  `;
  const messages = salvageChatMessages(malformed);
  assert.ok(Array.isArray(messages));
  assert.deepEqual(messages.map(item => item.type), ['image', 'transfer', 'schedule']);
  assert.equal(messages[0].description, '海边照片');
  assert.equal(messages[1].amount, 88.5);
  assert.equal(messages[2].title, '复习');
});

test('backup validation accepts normal data and rejects unsafe input', async () => {
  await importBrowserModule('jsonFilter.js');
  const guard = globalThis.window.JXBackupGuard;
  assert.ok(guard, 'JXBackupGuard should be exposed on window');

  const valid = guard.validate({
    format: 'jx-backup',
    version: 1,
    data: {
      friends: [{ id: '1', roleName: '律', setting: '角色设定' }],
      local_world_books: [{ id: 'wb1', title: '世界书', content: '正文' }]
    }
  });
  assert.equal(valid.valid, true);

  const sensitive = guard.validate({ data: { api_key: 'secret' } });
  assert.equal(sensitive.valid, false);

  const polluted = guard.validate({ data: { '__proto__': { admin: true } } });
  assert.equal(polluted.valid, false);
});

test('bridge keeps timeout and readable API error handling', async () => {
  const source = await read('bridge.js');
  assert.match(source, /CHAT_REQUEST_TIMEOUT_MS\s*=\s*90000/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /status === 429/);
  assert.match(source, /status === 413/);
  assert.match(source, /navigator\.onLine === false/);
});

test('service worker never caches chat completion or non-GET requests', async () => {
  const source = await read('sw.js');
  assert.match(source, /chat\/completions/);
  assert.match(source, /request\.method !== 'GET'/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /caches\.delete/);
});

test('keepalive remains low-frequency and respects user pause', async () => {
  const source = await read('KeepAliveSystem.js');
  assert.doesNotMatch(source, /setInterval\([\s\S]{0,200},\s*5000\)/);
  assert.match(source, /30000/);
  assert.doesNotMatch(source, /addEventListener\(['"]scroll['"]/);
  assert.doesNotMatch(source, /强制恢复播放以保活/);
});
