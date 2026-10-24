import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade, damit der Build auch in Unterverzeichnissen (z. B. GitHub Pages) läuft.
  base: './',
  // three.js ist groß; die Warnung ab 500 kB ist für ein Spiel nicht hilfreich.
  build: { chunkSizeWarningLimit: 1500 },
});
