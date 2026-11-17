import fs from 'node:fs';
import zlib from 'node:zlib';

// Streams a ZIP of files that already sit on disk, without packing it in memory first. The files are
// stored as they are (MP4 does not compress any further), each followed by a data descriptor with
// its CRC. ZIP64 records are written only when an offset or the count goes past the classic limits,
// so a folder of large videos of more than 4 GB together still opens everywhere.
export const MAX32 = 0xffffffff;

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Writes entries ({ name, path }) to `out` (an HTTP response or any writable) as one ZIP.
 * `limit` is the largest 32-bit value; tests pass a small one to exercise the ZIP64 records.
 * Stops quietly when the reader goes away. Returns false then, true when the archive is complete.
 */
export async function writeZip(out, entries, { limit = MAX32 } = {}) {
  const { time, date } = dosTime(new Date());
  const central = [];
  let offset = 0;
  let gone = false;
  out.once('close', () => { gone = true; });
  // Wait for room in the reader's buffer, or for the reader to leave; both listeners go again after,
  // so a slow download of many gigabytes does not pile up listeners.
  const room = () => new Promise((resolve) => {
    const done = () => { out.off('drain', done); out.off('close', done); resolve(); };
    out.on('drain', done);
    out.on('close', done);
  });
  const write = async (buf) => {
    if (gone) return;
    offset += buf.length;
    if (!out.write(buf)) await room();
  };

  for (const e of entries) {
    if (gone) return false;
    const name = Buffer.from(e.name, 'utf8');
    const size = fs.statSync(e.path).size;
    if (size >= MAX32) throw new Error(`${e.name} is groter dan 4 GB en past niet in dit ZIP-bestand.`);
    const start = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0808, 6); // data descriptor follows, names in UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // crc and sizes stay 0 here: they follow in the data descriptor
    local.writeUInt16LE(name.length, 26);
    await write(Buffer.concat([local, name]));

    let crc = 0;
    let written = 0;
    for await (const chunk of fs.createReadStream(e.path)) {
      if (gone) return false;
      crc = zlib.crc32(chunk, crc);
      written += chunk.length;
      await write(chunk);
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(written, 8);
    desc.writeUInt32LE(written, 12);
    await write(desc);
    central.push({ name, crc: crc >>> 0, size: written, start });
  }

  const cdStart = offset;
  for (const c of central) {
    const far = c.start >= limit;
    const extra = far ? Buffer.alloc(12) : Buffer.alloc(0);
    if (far) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(c.start), 4);
    }
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE((3 << 8) | 45, 4); // made by: unix, 4.5
    h.writeUInt16LE(far ? 45 : 20, 6);
    h.writeUInt16LE(0x0808, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(time, 12);
    h.writeUInt16LE(date, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.size, 20);
    h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.name.length, 28);
    h.writeUInt16LE(extra.length, 30);
    h.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    h.writeUInt32LE(far ? MAX32 : c.start, 42);
    await write(Buffer.concat([h, c.name, extra]));
  }
  const cdSize = offset - cdStart;

  const big = central.length >= 0xffff || cdStart >= limit || cdSize >= limit;
  if (big) {
    const z64At = offset;
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE((3 << 8) | 45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(central.length), 24);
    rec.writeBigUInt64LE(BigInt(central.length), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdStart), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(z64At), 8);
    loc.writeUInt32LE(1, 16);
    await write(Buffer.concat([rec, loc]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(big ? 0xffff : central.length, 8);
  end.writeUInt16LE(big ? 0xffff : central.length, 10);
  end.writeUInt32LE(big ? MAX32 : cdSize, 12);
  end.writeUInt32LE(big ? MAX32 : cdStart, 16);
  await write(end);
  if (!gone) out.end();
  return !gone;
}

/** A file name for inside the archive: no path parts, no characters that trouble Windows or macOS. */
export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
}
