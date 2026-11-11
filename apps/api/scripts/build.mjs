// Bundles the server and the CLI, dependencies included, into dist/, so running it needs only Node.
// The migrations go along in dist/drizzle. playwright-core reads its own files at run time, so it isn't
// bundled: it's copied to dist/node_modules (it has no dependencies of its own).
import { cp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });

await build({
  entryPoints: { main: path.join(root, 'src/main.ts'), cli: path.join(root, 'src/cli.ts') },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  // pg and ws try to load optional native add-ons; they aren't used
  external: ['pg-native', 'bufferutil', 'utf-8-validate', 'playwright-core'],
  // CommonJS dependencies inside an ES module bundle need require
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});
await cp(path.join(root, 'drizzle'), path.join(dist, 'drizzle'), { recursive: true });
const playwright = await realpath(path.dirname(createRequire(path.join(root, 'package.json')).resolve('playwright-core/package.json')));
await cp(playwright, path.join(dist, 'node_modules/playwright-core'), { recursive: true, dereference: true });
console.log('built dist/main.js, dist/cli.js, dist/drizzle and dist/node_modules/playwright-core');
