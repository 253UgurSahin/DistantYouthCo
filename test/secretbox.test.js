import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-box-'));
delete process.env.SECRET_KEY;
const { seal, open, isSealed } = await import('../src/secretbox.js');

test('X002: a sealed value opens again, and holds no plain text', () => {
  const s = seal('sk-ant-example-key');
  assert.ok(isSealed(s));
  assert.ok(!s.includes('sk-ant-example-key'));
  assert.ok(open(s) === 'sk-ant-example-key', 'round trip');
  assert.notEqual(seal('sk-ant-example-key'), s, 'a fresh nonce every time');
});

test('X002: without SECRET_KEY the key file is made once, readable by the owner only', () => {
  const file = path.join(process.env.DATA_DIR, 'secret.key');
  assert.ok(fs.existsSync(file));
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'no group or world access');
});

test('X002: a tampered value opens to nothing instead of garbage', () => {
  const s = seal('sk-ant-example-key');
  const bad = s.slice(0, -4) + (s.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal(open(bad), '');
  assert.equal(open(''), '');
  assert.equal(open('plain-old-value'), 'plain-old-value', 'values from before sealing still read');
});
