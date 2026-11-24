import type { FontId } from '../config/templates';
// Subset TrueType fonts built by scripts/build-fonts.py. In the Worker these imports are
// ArrayBuffers (wrangler "Data" rule); in tests the Vitest plugin does the same.
import dmSans400 from '../../assets/fonts/dm-sans-400.ttf';
import dmSans600 from '../../assets/fonts/dm-sans-600.ttf';
import inter400 from '../../assets/fonts/inter-400.ttf';
import inter600 from '../../assets/fonts/inter-600.ttf';
import manrope700 from '../../assets/fonts/manrope-700.ttf';
import publicSans400 from '../../assets/fonts/public-sans-400.ttf';
import publicSans600 from '../../assets/fonts/public-sans-600.ttf';
import sourceSerif700 from '../../assets/fonts/source-serif-4-700.ttf';
import spaceGrotesk700 from '../../assets/fonts/space-grotesk-700.ttf';

export const FONT_DATA: Record<FontId, ArrayBuffer> = {
  'source-serif-4-700': sourceSerif700,
  'public-sans-400': publicSans400,
  'public-sans-600': publicSans600,
  'manrope-700': manrope700,
  'inter-400': inter400,
  'inter-600': inter600,
  'space-grotesk-700': spaceGrotesk700,
  'dm-sans-400': dmSans400,
  'dm-sans-600': dmSans600,
};
