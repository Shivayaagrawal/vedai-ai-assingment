/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native addon used to downscale images before Gemini. Webpack cannot parse the .node binary.
    serverComponentsExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
