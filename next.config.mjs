/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Allow up to 20MB uploads for client agreement PDFs. Default is 1MB.
      bodySizeLimit: "20mb",
    },
    // mammoth pulls in dynamic requires that Next's bundler mangles; keep it
    // external so `require("mammoth")` resolves at runtime on the server.
    serverComponentsExternalPackages: ["mammoth", "pdf-parse"],
  },
};

export default nextConfig;
