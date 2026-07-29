/**
 * Copy each nested plugin's logo into dist.
 *
 * The shared build config only copies the logo paths named in the ROOT plugin.json, so
 * the bundled data source and panel ship without one and show a blank tile in Grafana's
 * plugin list. Pointing them at "../img/logo.svg" does not help either: Grafana resolves
 * a logo relative to that plugin's own directory, so it ends up requesting
 * public/plugins/img/logo.svg, which is outside every plugin and 404s.
 *
 * Run after `npm run build` (wired up as a postbuild script).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';

const SRC = 'src';
const DIST = 'dist';

function nestedPluginDirs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      continue;
    }
    if (existsSync(join(full, 'plugin.json'))) {
      out.push(full);
    }
    out.push(...nestedPluginDirs(full));
  }
  return out;
}

let copied = 0;
for (const pluginDir of nestedPluginDirs(SRC)) {
  const imgDir = join(pluginDir, 'img');
  if (!existsSync(imgDir)) {
    continue;
  }
  for (const file of readdirSync(imgDir)) {
    const to = join(DIST, pluginDir.slice(SRC.length + 1), 'img', file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(imgDir, file), to);
    copied++;
  }
}
console.log(`copied ${copied} nested plugin asset(s) into dist`);
