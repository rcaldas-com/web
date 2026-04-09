import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://redis');

export default redis;
