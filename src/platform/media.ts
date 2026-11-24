// Photos and images in R2. The editor resizes and re-encodes images in the browser; the
// server still checks the bytes, never trusts the file name or type, and strips metadata
// (EXIF can carry GPS location – CV-6).

export type MediaKind = 'photo' | 'project' | 'cover';

export const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; maxSide: number; formats: ReadonlyArray<'jpeg' | 'png'> }> = {
  // The photo is embedded in the PDF, so it must be a JPEG and small (CV-3: ≤ 500 kB in total).
  photo: { maxBytes: 300 * 1024, maxSide: 1200, formats: ['jpeg'] },
  project: { maxBytes: 600 * 1024, maxSide: 2000, formats: ['jpeg', 'png'] },
  cover: { maxBytes: 800 * 1024, maxSide: 2400, formats: ['jpeg', 'png'] },
};

export interface ImageInfo {
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // IHDR is the first chunk: width and height at offsets 16 and 20.
    if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the dimensions.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (b[i + 5]! << 8) | b[i + 6]!;
        const width = (b[i + 7]! << 8) | b[i + 8]!;
        return { format: 'jpeg', width, height };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Remove APP1–APP13 and APP15 segments (EXIF, XMP, IPTC, …) and comments from a JPEG. APP0
 * (JFIF) and APP14 (Adobe colour transform) stay; the image data is untouched.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      out.push(b.subarray(i));
      i = b.length;
      break;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const seg = b.subarray(i, i + 2 + len);
    const drop = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  if (i < b.length) out.push(b.subarray(i));
  const total = out.reduce((n, s) => n + s.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const s of out) {
    res.set(s, o);
    o += s.length;
  }
  return res;
}

/**
 * Keep only the PNG chunks needed to draw the image (and its colours); drop text, EXIF and
 * time chunks (tEXt, zTXt, iTXt, eXIf, tIME and any other ancillary chunk). Chunks are copied
 * whole, so their CRCs stay valid.
 */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);

export function stripPngMetadata(b: Uint8Array): Uint8Array {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return b;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) break;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const res = new Uint8Array(out.reduce((n, s) => n + s.length, 0));
  let o = 0;
  for (const s of out) {
    res.set(s, o);
    o += s.length;
  }
  return res;
}

export type MediaProblem = 'format' | 'size' | 'dimensions';

export function mediaMessage(kind: MediaKind, problem: MediaProblem): string {
  const lim = MEDIA_LIMITS[kind];
  if (problem === 'format') return kind === 'photo' ? 'Fotka musí být ve formátu JPEG.' : 'Obrázek musí být JPEG nebo PNG.';
  if (problem === 'size') return `Soubor je moc velký (nejvíc ${Math.round(lim.maxBytes / 1024)} kB). Editor ho při nahrání sám zmenší, pokud máte zapnutý JavaScript.`;
  return `Obrázek může mít nejvíc ${lim.maxSide} px na delší straně.`;
}

export function checkImage(kind: MediaKind, bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; problem: MediaProblem; message: string } {
  const lim = MEDIA_LIMITS[kind];
  const info = sniffImage(bytes);
  const fail = (problem: MediaProblem) => ({ ok: false as const, problem, message: mediaMessage(kind, problem) });
  if (!info || !lim.formats.includes(info.format)) return fail('format');
  if (bytes.length > lim.maxBytes) return fail('size');
  if (!info.width || !info.height || info.width > lim.maxSide || info.height > lim.maxSide) return fail('dimensions');
  return { ok: true, info };
}
