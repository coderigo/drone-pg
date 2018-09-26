const winston = require('winston');
const path = require('path');
const isProd = process.env.NODE_ENV === 'prod' || process.env.TESTON_ENV === 'prod';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || process.env.TESTON_LOG_LEVEL || 'info',
    format: winston.format.json(),
    colorize: true,
    transports: [
        // Where you want logs to go. Not written to file for now
    ],
});

if (!isProd) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.align(),
            winston.format.printf((info) => {
                const {
                    timestamp,
                    level,
                    message,
                    ...args
                } = info;

                const ts = timestamp.slice(0, 19).replace('T', ' ');
                return `${ts} [${level}]: ${message} ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ''}`;
            }),
        ),
    }));
}

module.exports = logger;