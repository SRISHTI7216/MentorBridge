import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

export const MAX_OFFICE_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_OFFICE_ENTRIES = 2000;
export type ZipEntry = { name: string; method: number; flags: number; crc: number; compressedSize: number; uncompressedSize: number; localOffset: number; directoryOffset: number };

/** Reads the ZIP directory only. No entry data is inflated or CRC-checked here. */
export function inspectOfficeZip(bytes: Buffer): Map<string, ZipEntry> {
  const min = Math.max(0, bytes.length - 22 - 0xffff); let eocd = -1;
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('invalid_document');
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== bytes.length || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) throw new Error('invalid_document');
  const diskCount = bytes.readUInt16LE(eocd + 8); const count = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12); const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (diskCount !== count || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('invalid_document');
  if (count > MAX_OFFICE_ENTRIES) throw new Error('extraction_limit');
  if (directoryOffset + directorySize > eocd || directoryOffset + directorySize > bytes.length) throw new Error('invalid_document');
  const entries = new Map<string, ZipEntry>(); let offset = directoryOffset; let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryOffset + directorySize || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid_document');
    const flags = bytes.readUInt16LE(offset + 8); const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16); const compressedSize = bytes.readUInt32LE(offset + 20); const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28); const extraLength = bytes.readUInt16LE(offset + 30); const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38); const localOffset = bytes.readUInt32LE(offset + 42);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > directoryOffset + directorySize || flags & (1 | 0x40 | 0x2000) || (method !== 0 && method !== 8) || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || localOffset >= directoryOffset || diskStart !== 0) throw new Error('invalid_document');
    let extraOffset = offset + 46 + nameLength;
    while (extraOffset < offset + 46 + nameLength + extraLength) {
      if (extraOffset + 4 > offset + 46 + nameLength + extraLength) throw new Error('invalid_document');
      const extraId = bytes.readUInt16LE(extraOffset); const extraSize = bytes.readUInt16LE(extraOffset + 2);
      if (extraOffset + 4 + extraSize > offset + 46 + nameLength + extraLength || extraId === 0x0001) throw new Error('invalid_document');
      extraOffset += 4 + extraSize;
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name: string;
    try {
      if (!(flags & 0x800) && nameBytes.some((value) => value > 0x7f)) throw new Error('bad_name');
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch { throw new Error('invalid_document'); }
    const normalized = name.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || path.posix.normalize(normalized) !== normalized || entries.has(normalized)) throw new Error('invalid_document');
    const fileType = (externalAttributes >>> 16) & 0xf000;
    if (fileType === 0xa000) throw new Error('invalid_document');
    declaredTotal += uncompressedSize;
    if (declaredTotal > MAX_OFFICE_ARCHIVE_BYTES) throw new Error('extraction_limit');
    entries.set(normalized, { name: normalized, method, flags, crc, compressedSize, uncompressedSize, localOffset, directoryOffset });
    offset = end;
  }
  if (offset !== directoryOffset + directorySize) throw new Error('invalid_document');
  return entries;
}

/** Bounded single-entry extraction with local-header, size and CRC validation. */
export function extractZipEntry(bytes: Buffer, entry: ZipEntry, outputLimit = MAX_OFFICE_ARCHIVE_BYTES): Buffer {
  if (entry.uncompressedSize > outputLimit) throw new Error('extraction_limit');
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('invalid_document');
  const flags = bytes.readUInt16LE(offset + 6); const method = bytes.readUInt16LE(offset + 8);
  const nameLength = bytes.readUInt16LE(offset + 26); const extraLength = bytes.readUInt16LE(offset + 28);
  if (flags !== entry.flags || method !== entry.method || flags & 1) throw new Error('invalid_document');
  const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLength);
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes).replace(/\\/g, '/');
  if (localName !== entry.name) throw new Error('invalid_document');
  const start = offset + 30 + nameLength + extraLength; const end = start + entry.compressedSize;
  if (end > entry.directoryOffset || end > bytes.length || start < offset) throw new Error('invalid_document');
  const compressed = bytes.subarray(start, end);
  let result: Buffer;
  try {
    if (entry.method === 0) result = Buffer.from(compressed);
    else result = inflateRawSync(compressed, { maxOutputLength: Math.min(outputLimit, entry.uncompressedSize) + 1 });
  } catch { throw new Error('invalid_document'); }
  if (result.length !== entry.uncompressedSize || crc32(result) !== entry.crc) throw new Error('invalid_document');
  return result;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
