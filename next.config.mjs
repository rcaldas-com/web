/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
    assetPrefix: isDev ? undefined : process.env.AUTH_TRUST_HOST,
    output: "standalone",
    // images: {
    //     remotePatterns: [
    //         {
    //             protocol: 'https',
    //             hostname: 'boragora.app',
    //         },
    //     ]
    // }
};

export default nextConfig;
