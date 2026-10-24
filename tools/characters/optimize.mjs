// Komprimiert die erzeugten Figuren (Meshopt-Geometrie, WebP-Texturen) für das Web.
// Aufruf: npm run characters:optimize
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'tools/characters/out';
const dst = 'public/models/players';
mkdirSync(dst, { recursive: true });

for (const file of readdirSync(src).filter((f) => f.endsWith('.glb'))) {
  execFileSync(
    'npx',
    [
      'gltf-transform', 'optimize', join(src, file), join(dst, file),
      '--compress', 'meshopt',
      '--texture-compress', 'webp',
      '--texture-size', '1024',
      // Materialnamen (Jersey, Shorts, ...) müssen erhalten bleiben
      '--palette', 'false', '--join', 'false', '--flatten', 'false', '--instance', 'false',
      '--simplify', 'false',
      // Das Trikot hat in Blender noch keine Textur, braucht aber seine UVs für die Rückennummer
      '--prune-attributes', 'false',
    ],
    { stdio: 'inherit' },
  );
}
copyFileSync(join(src, 'players.json'), join(dst, 'players.json'));
