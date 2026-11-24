// WCAG 2.x contrast for the accent colour check (CV-2).

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 0;
  const la = luminance(ra);
  const lb = luminance(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** RGB in 0..1 for pdf-lib. */
export function hexToRgb01(hex: string): [number, number, number] {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** Mix a colour with white; used for light accent tints (e.g. rules and tag backgrounds). */
export function tint(hex: string, amount: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const mixed = rgb.map((c) => Math.round(c + (255 - c) * amount));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}
