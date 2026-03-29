import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MillSuite — Project Profit Tracker',
    short_name: 'MillSuite',
    description: 'Know your numbers. Every project, every dollar.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#F9FAFB',
    theme_color: '#111111',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
