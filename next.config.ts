import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The sandbox SDK and all secrets stay server-side; never import them from client components.
  serverExternalPackages: ["@nodeops-createos/sandbox"],
  // Files the API routes read at runtime (scoring library, replay script, fixture) must ship with the build.
  outputFileTracingIncludes: {
    "/api/**": ["./sandbox/**/*", "./data/fixtures/**/*"],
  },
};

export default nextConfig;
