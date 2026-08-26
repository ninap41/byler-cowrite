// A minimal ZIP writer (deflate, no dependencies) for the admin content
// backup: buildZip([{name, data}]) -> Buffer. Only what a backup needs —
// no directories, no zip64, UTF-8 names, timestamps from `at`.
import { deflateRawSync, crc32 } from "node:zlib";

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export function buildZip(files, at = new Date()) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name), "utf-8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf-8");
    const deflated = deflateRawSync(raw);
    const stored = deflated.length < raw.length ? deflated : raw;
    const method = stored === raw ? 0 : 8;
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); // utf-8 flag
    head.writeUInt16LE(method, 8); head.writeUInt16LE(dosTime(at), 10); head.writeUInt16LE(dosDate(at), 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(stored.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10); cen.writeUInt16LE(dosTime(at), 12); cen.writeUInt16LE(dosDate(at), 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(stored.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    locals.push(head, name, stored);
    centrals.push(cen, name);
    offset += head.length + name.length + stored.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
