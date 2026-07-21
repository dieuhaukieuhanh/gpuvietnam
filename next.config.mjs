/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    // Native addon — must not be webpack-bundled on Vercel.
    serverComponentsExternalPackages: ['ssh2', 'cpu-features'],
  },
  // Apex cut-over: retire WordPress paths after DNS points here.
  async redirects() {
    return [
      { source: '/wp-admin', destination: '/login', permanent: true },
      { source: '/wp-admin/:path*', destination: '/login', permanent: true },
      { source: '/wp-login.php', destination: '/login', permanent: true },
      { source: '/feed', destination: '/', permanent: true },
      { source: '/feed/:path*', destination: '/', permanent: true },
      { source: '/dieu-khoan', destination: '/dieu-khoan-dich-vu', permanent: true },
      { source: '/chinh-sach', destination: '/chinh-sach-bao-mat', permanent: true },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('ssh2', 'cpu-features');
    }
    return config;
  },
};

export default nextConfig;
