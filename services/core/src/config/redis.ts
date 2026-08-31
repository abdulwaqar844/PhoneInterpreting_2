import { createClient } from 'redis';
import { logger } from './logger';
import { vars } from './vars';

const redisClient = createClient({
    url: vars.redis.uri,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

export { redisClient };
