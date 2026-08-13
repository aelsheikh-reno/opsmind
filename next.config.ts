import type { NextConfig } from "next";

// `standalone` emits .next/standalone with a minimal server.js and only the
// traced node_modules. That directory is what the staging image ships, so this
// key is a deployment dependency, not a preference — see Dockerfile.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
