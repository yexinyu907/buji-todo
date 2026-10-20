// A deliberately bounded ZIP subset: regular UTF-8 files, STORE/DEFLATE only.
const zlib = require('node:zlib');
const MAX_TOTAL = 250 * 1024 * 1024, MAX_FILE = 32 * 1024 * 1024, MAX_FILES = 4000;
const table = Array.from({ length: 256 }, (_, i) => { let x = i; for (let j = 0; j < 8; j++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; return x >>> 0; });
function crc32(bytes) { let x = 0xffffffff; for (const b of bytes) x = table[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; }
function safeName(name) { return typeof name === 'string' && /^(?:manifest\.json|data\.json|sync\.json|images\/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|gif|webp|bmp))$/i.test(name); }
function pack(entries) {
  const chunks = [], central = []; let offset = 0, total = 0;
  if (entries.size > MAX_FILES) throw new Error('备份文件数量过多。');
  for (const [name, value] of entries) {
    const bytes = Buffer.from(value), filename = Buffer.from(name); total += bytes.length;
    if (!safeName(name) || bytes.length > MAX_FILE || total > MAX_TOTAL) throw new Error('备份内容或大小超出支持范围。');
    const compressed = name.endsWith('.json') ? zlib.deflateRawSync(bytes) : bytes, method = name.endsWith('.json') ? 8 : 0, crc = crc32(bytes);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(compressed.length, 18); h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(filename.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    chunks.push(h, filename, compressed); central.push(c, filename); offset += h.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function unpack(input) {
  try {
    const b = Buffer.from(input); if (b.length < 22 || b.length > MAX_TOTAL + 1024 * 1024) throw new Error('size');
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
    if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) throw new Error('multi-disk');
    const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16);
    if (!count || count > MAX_FILES || count !== b.readUInt16LE(end + 8) || start + size !== end) throw new Error('directory');
    const result = new Map(), ranges = []; let cursor = start, total = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50) throw new Error('header');
      const flags = b.readUInt16LE(cursor + 8), method = b.readUInt16LE(cursor + 10), crc = b.readUInt32LE(cursor + 16), packed = b.readUInt32LE(cursor + 20), length = b.readUInt32LE(cursor + 24), n = b.readUInt16LE(cursor + 28), extra = b.readUInt16LE(cursor + 30), comment = b.readUInt16LE(cursor + 32), local = b.readUInt32LE(cursor + 42);
      if ((flags & ~0x800) || ![0, 8].includes(method) || b.readUInt16LE(cursor + 34) || length > MAX_FILE || (total += length) > MAX_TOTAL || cursor + 46 + n + extra + comment > end) throw new Error('limits');
      const rawName = b.subarray(cursor + 46, cursor + 46 + n), name = rawName.toString('utf8');
      if (!safeName(name) || !Buffer.from(name).equals(rawName) || result.has(name) || local + 30 > start || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method || b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== packed || b.readUInt32LE(local + 22) !== length) throw new Error('entry');
      const ln = b.readUInt16LE(local + 26), le = b.readUInt16LE(local + 28), dataStart = local + 30 + ln + le, dataEnd = dataStart + packed;
      if (ln !== n || !b.subarray(local + 30, local + 30 + ln).equals(rawName) || dataEnd > start || ranges.some(([a, z]) => local < z && dataEnd > a)) throw new Error('range');
      ranges.push([local, dataEnd]);
      const data = method === 0 ? b.subarray(dataStart, dataEnd) : zlib.inflateRawSync(b.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, length) });
      if (data.length !== length || crc32(data) !== crc) throw new Error('checksum');
      result.set(name, Buffer.from(data)); cursor += 46 + n + extra + comment;
    }
    if (cursor !== end) throw new Error('end'); return result;
  } catch { throw new Error('备份压缩包损坏，或包含不支持的内容；当前数据未改动。'); }
}
module.exports = { pack, unpack, crc32, safeName, MAX_TOTAL };
