// A ZIP file built in the browser (stored entries, no compression): media and site exports, made from
// files the browser reads from the public site. The archive is a Blob of parts, so its size has no
// fixed limit beyond the browser's memory.
(() => {
  'use strict';
  const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  window.MikanZip = function () {
    const parts = [], central = [], encoder = new TextEncoder();
    let offset = 0, count = 0;
    const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    this.add = (name, bytes) => {
      const path = encoder.encode(name.replace(/^\/+/, '')), crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, bytes.length, 4], [22, bytes.length, 4], [26, path.length, 2], [28, 0, 2]]
        .forEach(([at, value, size]) => size === 4 ? local.setUint32(at, value, true) : local.setUint16(at, value, true));
      const entry = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, bytes.length, 4], [24, bytes.length, 4], [28, path.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
        .forEach(([at, value, size]) => size === 4 ? entry.setUint32(at, value, true) : entry.setUint16(at, value, true));
      parts.push(local.buffer, path, bytes); central.push(entry.buffer, path);
      offset += 30 + path.length + bytes.length; count++;
    };
    this.blob = () => {
      const size = central.reduce((total, part) => total + (part.byteLength ?? part.length), 0), end = new DataView(new ArrayBuffer(22));
      [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, count, 2], [10, count, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
        .forEach(([at, value, sz]) => sz === 4 ? end.setUint32(at, value, true) : end.setUint16(at, value, true));
      return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    };
  };
  window.mikanDownload = (blob, name) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
})();
