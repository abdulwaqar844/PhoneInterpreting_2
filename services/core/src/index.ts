import { runBootTasks } from './boot';
import { logger } from './config/logger';

async function start() {
    await runBootTasks();
}

start().catch((e) => {
    logger.error(e.message);
    process.exit();
});
