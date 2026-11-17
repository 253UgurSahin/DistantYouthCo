import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { writeZip, safeName } from '../src/zip.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-zip-'));
const a = path.join(dir, 'a.mp4');
const b = path.join(dir, 'b.mp4');
fs.writeFileSync(a, Buffer.alloc(70000, 7));
fs.writeFileSync(b, Buffer.from('second video, with ünïcode in its name'));

async function zipOf(entries, opts) {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => out.on('end', r));
  assert.equal(await writeZip(out, entries, opts), true);
  await done;
  return Buffer.concat(chunks);
}

// Reads the central directory back, the way an unzip tool finds the files.
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff) {
    const z = buf.readBigUInt64LE(end - 20 + 8);
    count = Number(buf.readBigUInt64LE(Number(z) + 32));
    at = Number(buf.readBigUInt64LE(Number(z) + 48));
  }
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 24);
    const nl = buf.readUInt16LE(at + 28), xl = buf.readUInt16LE(at + 30);
    let off = buf.readUInt32LE(at + 42);
    if (off === 0xffffffff) off = Number(buf.readBigUInt64LE(at + 46 + nl + 4));
    const name = buf.toString('utf8', at + 46, at + 46 + nl);
    const data = buf.subarray(off + 30 + buf.readUInt16LE(off + 26), off + 30 + buf.readUInt16LE(off + 26) + size);
    files.push({ name, crc, ok: zlib.crc32(data) >>> 0 === crc, size });
    at += 46 + nl + xl;
  }
  return files;
}

test('a ZIP of stored videos opens with the right names and contents', async () => {
  const buf = await zipOf([{ name: 'Lanterns in the Rain (Official Visualizer).mp4', path: a }, { name: 'Ünïcode.mp4', path: b }]);
  const files = readZip(buf);
  assert.deepEqual(files.map((f) => f.name), ['Lanterns in the Rain (Official Visualizer).mp4', 'Ünïcode.mp4']);
  assert.ok(files.every((f) => f.ok), 'every CRC matches its data');
  assert.equal(files[0].size, 70000);
});

test('past the 4 GB limits it writes ZIP64 records (here with a small limit), and unzip tools read it', async () => {
  const p = path.join(dir, 'big.zip');
  const buf = await zipOf([{ name: 'a.mp4', path: a }, { name: 'b.mp4', path: b }], { limit: 1000 });
  fs.writeFileSync(p, buf);
  assert.deepEqual(readZip(buf).map((f) => f.ok), [true, true]);
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist()))', p], { encoding: 'utf8' });
  if (py.error) return; // no python here: the JS check above stands
  assert.equal(py.status, 0, py.stderr);
  assert.equal(py.stdout.trim(), 'a.mp4,b.mp4');
});

test('names inside the archive lose path parts and troublesome characters', () => {
  assert.equal(safeName('../a/b: "c"?'), '.. a b c');
  assert.equal(safeName(''), 'video');
});

test('a slow reader does not pile up listeners while a big file streams', async () => {
  const big = path.join(dir, 'big.mp4');
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 3));
  let most = 0;
  const out = new Writable({
    highWaterMark: 1024,
    write(chunk, enc, cb) {
      most = Math.max(most, this.listenerCount('close'), this.listenerCount('drain'));
      setImmediate(cb);
    },
  });
  const warnings = [];
  const onWarn = (w) => warnings.push(w.name);
  process.on('warning', onWarn);
  assert.equal(await writeZip(out, [{ name: 'big.mp4', path: big }]), true);
  process.off('warning', onWarn);
  assert.ok(most <= 3, `at most a few listeners at a time (saw ${most})`);
  assert.ok(!warnings.includes('MaxListenersExceededWarning'));
});

