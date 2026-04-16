import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const rawBase = process.env.VITE_BASE_PATH ?? '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon.svg',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        '.nojekyll'
      ],
      manifest: {
        id: base,
        name: 'Stonks',
        short_name: 'Stonks',
        description: 'A local-first investment thesis journal for iPhone.',
        theme_color: '#10242f',
        background_color: '#f2eee3',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        lang: 'en-US',
        categories: ['finance', 'productivity'],
        prefer_related_applications: false,
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
});
