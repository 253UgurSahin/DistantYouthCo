// Copies the two open fonts the app uses (SIL OFL) from their npm packages into public/fonts:
// only the files their CSS names. Run again after updating them: npm run build:fonts
import fs from 'node:fs';
import path from 'node:path';

for (const name of ['inter', 'montserrat']) {
  const src = path.join('node_modules', '@fontsource-variable', name);
  const dst = path.join('public', 'fonts', name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, 'files'), { recursive: true });
  const css = fs.readFileSync(path.join(src, 'index.css'), 'utf8');
  fs.writeFileSync(path.join(dst, 'index.css'), css);
  for (const [, file] of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) fs.copyFileSync(path.join(src, 'files', file), path.join(dst, 'files', file));
  fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dst, 'LICENSE'));
}
console.log('public/fonts bijgewerkt');
