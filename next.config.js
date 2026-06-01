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
  // Build ID baked into the client at build time. Vercel sets
  // VERCEL_GIT_COMMIT_SHA per deploy, so this changes on every production
  // deploy — which is exactly what the "update available" banner keys off
  // (it compares the version a session loaded with against the live one
  // from /api/version). Falls back to 'dev' locally so the banner stays
  // dormant in development.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
}

module.exports = nextConfig
