import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';

const base = new URL(process.env.RELAY_URL || 'http://127.0.0.1:8000');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('RELAY_URL must be an http(s) origin with no credentials or path');
}
if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Remote relays require HTTPS');
}
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['background', 'offscreen', 'panel', 'pcm-worklet', 'mic-permission'].map(name => `src/${name}.ts`),
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome116',
  define: { __RELAY_URL__: JSON.stringify(base.origin) },
});
for (const file of ['offscreen.html', 'panel.html', 'panel.css', 'mic-permission.html']) {
  await cp(`static/${file}`, `dist/${file}`);
}
await cp('static/icons', 'dist/icons', { recursive: true });
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
await writeFile('dist/manifest.json', JSON.stringify({
  manifest_version: 3,
  name: 'Meeting Notes',
  version: '0.6.0',
  minimum_chrome_version: '116',
  permissions: ['tabCapture', 'offscreen', 'sidePanel', 'activeTab'],
  host_permissions: [`${base.origin}/*`],
  icons,
  action: { default_title: 'Open Meeting Notes', default_icon: icons },
  side_panel: { default_path: 'panel.html' },
  background: { service_worker: 'background.js' },
}, null, 2) + '\n');
