// Builds the version for shared hosting (PHP): dist/shared-host/ and one ZIP to upload.
//   node scripts/build-shared-host.mjs
// public_html/   what the visitor's browser loads, plus index.php (the door for /api, /media, /downloads)
// distantyouth/  the server code in PHP and, once it runs, your data: next to public_html, not in it
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from '../backend/node/zip.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT = path.join(ROOT, 'dist', 'shared-host');
fs.rmSync(OUT, { recursive: true, force: true });

const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (s) => !path.basename(s).startsWith('.DS_Store') });
const web = path.join(OUT, 'public_html');
const app = path.join(OUT, 'distantyouth');

copy(path.join(ROOT, 'frontend'), web);
copy(path.join(ROOT, 'backend', 'php', 'public_html', 'index.php'), path.join(web, 'index.php'));
copy(path.join(ROOT, 'backend', 'php', 'public_html', '.htaccess'), path.join(web, '.htaccess'));
// The fonts come from their packages (the Node.js server serves them from node_modules).
for (const name of ['inter', 'montserrat']) {
  const src = path.join(ROOT, 'node_modules', '@fontsource-variable', name);
  const dst = path.join(web, 'fonts', name);
  const css = fs.readFileSync(path.join(src, 'index.css'), 'utf8');
  fs.mkdirSync(path.join(dst, 'files'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'index.css'), css);
  for (const [, file] of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) copy(path.join(src, 'files', file), path.join(dst, 'files', file));
  copy(path.join(src, 'LICENSE'), path.join(dst, 'LICENSE'));
}

copy(path.join(ROOT, 'backend', 'php', 'app'), path.join(app, 'app'));
fs.writeFileSync(path.join(app, 'VERSION'), version + '\n');
fs.writeFileSync(path.join(app, '.htaccess'), '<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n');
fs.writeFileSync(path.join(app, 'config.voorbeeld.php'), `<?php
// Optioneel. Hernoem naar config.php om iets in te stellen; alles mag ook leeg blijven.
return [
    // Een lange willekeurige tekst. Hiermee wordt een in de app opgeslagen Claude-key versleuteld.
    // Leeg: de app maakt zelf data/secret.key aan (bewaar die bij je back-ups).
    'secret_key' => '',
    // Een Claude API key hier in plaats van in Instellingen (optioneel).
    'anthropic_api_key' => '',
    // '1' als je site achter Cloudflare of een andere proxy draait.
    'trust_proxy' => '0',
    // Een andere plek voor de database en je bestanden (optioneel).
    'data_dir' => '',
];
`);
fs.copyFileSync(path.join(ROOT, 'backend', 'php', 'LEESMIJ.txt'), path.join(OUT, 'LEESMIJ.txt'));

// One ZIP of it all, to upload with the host's file manager and unpack there.
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ name: path.relative(OUT, p).split(path.sep).join('/'), path: p });
  }
};
walk(OUT);
const zipPath = path.join(ROOT, 'dist', `distantyouth-shared-host-v${version}.zip`);
const out = fs.createWriteStream(zipPath);
await writeZip(out, files);
await new Promise((r) => out.on('finish', r));
console.log(`dist/shared-host/ en ${path.relative(ROOT, zipPath)} (${files.length} bestanden, versie ${version})`);
