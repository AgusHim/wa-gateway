import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@whiskeysockets/baileys", "@prisma/client", "prisma"],
  turbopack: {
    resolveAlias: {
      jimp: "./src/shims/jimp.ts",
      sharp: "./src/shims/sharp.ts",
    },
  },
};

export default nextConfig;
