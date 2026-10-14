import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Pin the workspace root so a lockfile in a parent directory is never picked up.
  turbopack: { root: process.cwd() },
  // postgres.js and nodemailer are server-only Node libraries.
  serverExternalPackages: ["postgres", "nodemailer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
