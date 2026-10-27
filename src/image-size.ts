// Intrinsic pixel size from the first bytes of an image, like PHP's getimagesize() for the formats Cloud accepts.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes, u16 = (i: number) => (b[i] << 8) | b[i + 1], le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const ascii = (a: number, z: number) => String.fromCharCode(...b.subarray(a, z));
  let size: [number, number] | null = null;
  if (b.length > 24 && b[0] === 137 && ascii(1, 4) === 'PNG') {
    size = [((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0];
  } else if (b.length > 10 && ascii(0, 3) === 'GIF') {
    size = [le16(6), le16(8)];
  } else if (b.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16);
    if (kind === 'VP8X') size = [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
    else if (kind === 'VP8L' && b[20] === 0x2f) { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; size = [1 + (v & 0x3fff), 1 + ((v >>> 14) & 0x3fff)]; }
    else if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) size = [le16(26) & 0x3fff, le16(28) & 0x3fff];
  } else if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = u16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { size = [u16(i + 7), u16(i + 5)]; break; }
      i += 2 + length;
    }
  }
  return size && size[0] > 0 && size[1] > 0 ? { width: size[0], height: size[1] } : null;
}
