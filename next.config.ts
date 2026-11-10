import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AGENTS.md is the project's own rule file; stop `next dev` from appending to it.
  agentRules: false,
  // Loaded with Node's own require at runtime (large CommonJS bundle, real-PayPal mode only).
  serverExternalPackages: ["@paypal/agent-toolkit"],
  // Tailwind 4 is wired through the Turbopack CSS loader in this template.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
