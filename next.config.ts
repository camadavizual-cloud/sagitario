import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const noStore = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
      { key: "Surrogate-Control", value: "no-store" },
    ];
    return [
      { source: "/", headers: noStore },
      { source: "/admin", headers: noStore },
    ];
  },
};

export default nextConfig;
