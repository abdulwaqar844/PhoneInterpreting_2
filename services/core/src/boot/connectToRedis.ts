import { redisClient } from '../config/redis';
import { logger } from '../config/logger';

export const connectToRedis = async () => {
    logger.info('redis:connecting:start');
    await redisClient.connect();
    await redisClient.flushDb();
    logger.info('redis:connecting:completed');
};
