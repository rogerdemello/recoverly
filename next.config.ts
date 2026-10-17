import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The sandbox SDK and all secrets stay server-side; never import them from client components.
  serverExternalPackages: ["@nodeops-createos/sandbox"],
};

export default nextConfig;
