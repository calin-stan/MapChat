import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["map-chat.map-chat.test"],
  // `page.dev.tsx` is a route for the dev server only. A production build does
  // not list the extension, so the e2e fixtures under src/app/e2e never ship.
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? ["tsx", "ts", "jsx", "js"]
      : ["tsx", "ts", "jsx", "js", "dev.tsx"],
};

export default nextConfig;
