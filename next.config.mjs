/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Allow up to 20MB uploads for client agreement PDFs. Default is 1MB.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
