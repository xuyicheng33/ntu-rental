import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'sg1-cdn.pgimgs.com',
      },
      {
        protocol: 'https',
        hostname: 'imagedelivery.net',
      },
    ],
  },
};

export default nextConfig;
