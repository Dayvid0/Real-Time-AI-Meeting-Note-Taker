import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const source = 'dist';
const output = 'meeting-notes-extension.zip';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function files(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

const chunks = [], central = [];
let offset = 0;
for (const path of await files(source)) {
  const name = relative(source, path).replaceAll('\\', '/');
  const nameBytes = Buffer.from(name);
  const data = await readFile(path);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  chunks.push(local, nameBytes, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0, 8); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);
  offset += local.length + nameBytes.length + compressed.length;
}
const centralSize = central.reduce((sum, item) => sum + item.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
await writeFile(output, Buffer.concat([...chunks, ...central, end]));
console.log(`Created ${basename(output)} from ${central.length / 2} files.`);
