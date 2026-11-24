import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// In the Worker, wrangler's "Data" rule turns `import x from './font.ttf'` into an ArrayBuffer.
// This plugin does the same for tests running in Node.
const binaryModules = {
  name: 'binary-modules',
  enforce: 'pre' as const,
  load(id: string) {
    const path = id.split('?')[0]!;
    if (!path.endsWith('.ttf')) return null;
    const b64 = readFileSync(path).toString('base64');
    return `const s = atob(${JSON.stringify(b64)}); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); export default u.buffer;`;
  },
};

export default defineConfig({
  plugins: [binaryModules],
  esbuild: { jsx: 'automatic', jsxImportSource: 'hono/jsx' },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    pool: 'forks',
  },
});
