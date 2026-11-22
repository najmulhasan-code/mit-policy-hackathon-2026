import type { NextConfig } from "next";

// The interface is built into static files in out/, which the Python server serves.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
