import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
