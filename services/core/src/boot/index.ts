import { connectToPostgres } from './connectToPostgres';
import { connectToRedis } from './connectToRedis';
import { startApiServer } from './startApiServer';
import { logger } from '../config/logger';

export const runBootTasks = async () => {
    logger.info('BootTasks:running:start');
    await connectToPostgres();
    await connectToRedis();
    await startApiServer();
    logger.info('BootTasks:running:complete');
};
