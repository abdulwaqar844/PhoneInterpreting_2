import { db, pool } from '../config/postgres';
import { logger } from '../config/logger';

export const connectToPostgres = async () => {
    try {
        logger.info("postgres:connecting:start");

        const result = await pool.query("SELECT NOW()");
        if (result) {
            logger.info("postgres:connecting:completed");
        }

        // Setup shutdown handler
        process.on("SIGTERM", async () => {
            await pool.end();
            logger.info("postgres:connection:closed");
        });

        return db;
    } catch (error) {
        logger.error(`postgres:connecting:failed - ${error}`);
        throw error;
    }
};

export const disconnectFromPostgres = async () => {
    try {
        await pool.end();
        logger.info("postgres:disconnected");
    } catch (error) {
        logger.error(`postgres:disconnect:failed - ${error}`);
        throw error;
    }
};
