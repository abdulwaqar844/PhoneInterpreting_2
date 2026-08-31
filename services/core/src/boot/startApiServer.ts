import { logger } from '../config/logger';
import { vars } from '../config/vars';
import { httpServer } from '../config/express';

const { port, env } = vars;

export const startApiServer = async () => {
    logger.info('boot:apiServer:start');
    httpServer.listen(port, () => {
        logger.info(`Core started on port ${port} (${env})`);
    });
    logger.info('boot:apiServer:complete');
};
