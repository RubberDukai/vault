'use strict';
/**
 * Minimal ZIP reader — enough to open an EPUB, which is a ZIP by another name.
 *
 * Reads the central directory from the end of the file, then pulls entries on
 * demand. Deflate is Node's own zlib. No ZIP64, no encryption, no multi-disk:
 * none of which an e-book uses.
 *
 * Format reference: PKWARE APPNOTE, sections 4.3.7 (local header),
 * 4.3.12 (central directory) and 4.3.16 (end of central directory).
 */

const fsp = require('node:fs/promises');
const zlib = require('node:zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

class ZipFile {
  constructor(handle, size) {
    this.fh = handle;
    this.size = size;
    this.entries = new Map();
  }

  static async open(filePath) {
    const handle = await fsp.open(filePath, 'r');
    const { size } = await handle.stat();
    const zip = new ZipFile(handle, size);
    try {
      await zip._readCentralDirectory();
    } catch (err) {
      await handle.close();
      throw err;
    }
    return zip;
  }

  async close() {
    await this.fh.close();
  }

  async _read(offset, length) {
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  }

  async _readCentralDirectory() {
    // The end-of-central-directory record is in the last 22 bytes unless the
    // archive has a comment, which can push it back by up to 64 KB.
    const tailLength = Math.min(this.size, 22 + 65535);
    const tail = await this._read(this.size - tailLength, tailLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('Not a ZIP archive (no end-of-central-directory record)');

    const entryCount = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);

    const directory = await this._read(directoryOffset, directorySize);
    let p = 0;

    for (let i = 0; i < entryCount && p + 46 <= directory.length; i++) {
      if (directory.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new Error('Corrupt ZIP central directory');
      }
      const method = directory.readUInt16LE(p + 10);
      const compressedSize = directory.readUInt32LE(p + 20);
      const uncompressedSize = directory.readUInt32LE(p + 24);
      const nameLength = directory.readUInt16LE(p + 28);
      const extraLength = directory.readUInt16LE(p + 30);
      const commentLength = directory.readUInt16LE(p + 32);
      const localOffset = directory.readUInt32LE(p + 42);
      const name = directory.toString('utf8', p + 46, p + 46 + nameLength);

      this.entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  list() {
    return [...this.entries.keys()];
  }

  /** Read and decompress one entry. */
  async read(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;

    // The local header repeats the name and extra fields, and their lengths
    // here can differ from the central directory's, so read them fresh.
    const local = await this._read(entry.localOffset, 30);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`Corrupt local header for ${name}`);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;

    const raw = await this._read(dataStart, entry.compressedSize);

    switch (entry.method) {
      case METHOD_STORED:
        return raw;
      case METHOD_DEFLATE:
        return zlib.inflateRawSync(raw, { maxOutputLength: 256 * 1024 * 1024 });
      default:
        throw new Error(`Unsupported ZIP compression method ${entry.method} in ${name}`);
    }
  }

  async readText(name) {
    const buf = await this.read(name);
    return buf === null ? null : buf.toString('utf8');
  }
}

module.exports = { ZipFile };
