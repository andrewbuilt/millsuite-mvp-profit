/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript errors now BLOCK the build (L6). They're high-signal — wrong
  // data shapes, missing fields, broken webhook contracts — and worth
  // stopping a deploy over. Keep the tree type-clean (`npx tsc --noEmit`)
  // before pushing.
  typescript: { ignoreBuildErrors: false },
  // ESLint stays non-blocking: lint is mostly style/unused-var noise that
  // shouldn't gate a deploy. Run `npm run lint` when you want to tidy up.
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
