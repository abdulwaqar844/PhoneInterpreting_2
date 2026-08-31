import winston from 'winston';

const transports = [] as winston.transport[];

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format((info) => {
            // eslint-disable-next-line no-param-reassign
            info.message = `Log ${info.level} on core: \n${info.message}`;
            return info;
        })(),
    ),
    transports,
});

logger.add(new winston.transports.Console({
    format: winston.format.simple(),
}));

export { logger };
