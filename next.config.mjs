/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
    assetPrefix: isDev ? undefined : process.env.AUTH_TRUST_HOST,
    output: "standalone",
    experimental: {
        serverActions: {
            bodySizeLimit: '10mb',
        },
    },
};

export default nextConfig;
