// Minify the browser scripts in src/client into public/static (served as static assets).
// Run by `npm run build:client`, and by wrangler before dev and deploy ([build] in wrangler.toml).
import { build } from 'esbuild';

const entries = { reveal: 'src/client/reveal.js', editor: 'src/client/editor.js' };

export async function buildClient(write = true) {
  const out = {};
  for (const [name, entry] of Object.entries(entries)) {
    const r = await build({
      entryPoints: [entry],
      bundle: false,
      minify: true,
      target: ['es2020', 'safari15'],
      legalComments: 'none',
      write,
      outfile: `public/static/${name}.js`,
    });
    if (!write) out[name] = r.outputFiles[0].text;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildClient(true);
  console.log('built public/static/{reveal,editor}.js');
}
