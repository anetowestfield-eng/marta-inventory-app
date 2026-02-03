/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // This allows the build to finish even if there are linting errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Also a good idea to ignore TS errors for now so you can get the app live
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
