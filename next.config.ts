import type { NextConfig } from "next";

// Netlify sets NETLIFY=true during its builds. This app is fully client-side
// (no API routes, no SSR data), so a static export is the most robust
// deployment mode on Netlify: it needs no server functions and is served
// straight from the CDN. Local builds keep the standalone output used by
// `npm start`.
const isNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  ...(isNetlify
    ? { output: "export", images: { unoptimized: true } }
    : { output: "standalone" }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
