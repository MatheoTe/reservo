import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// GitHub Codespaces serves the dev server from https://<name>-3000.app.github.dev
// and forwards its own host, so both dev assets and Server Actions need the
// forwarded domain allow-listed. Only when actually running in a codespace.
const codespacesDomain = process.env.CODESPACES
  ? (process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev")
  : undefined;

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Pin the workspace root so a lockfile in a parent directory is never picked up.
  turbopack: { root: process.cwd() },
  // postgres.js and nodemailer are server-only Node libraries.
  serverExternalPackages: ["postgres", "nodemailer"],
  ...(codespacesDomain
    ? {
        allowedDevOrigins: [`*.${codespacesDomain}`],
        experimental: { serverActions: { allowedOrigins: [`*.${codespacesDomain}`] } },
      }
    : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
