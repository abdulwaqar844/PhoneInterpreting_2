import dotenv from 'dotenv';
import { parseNumber } from '../utils/parsers/parseNumber';
import { parseString } from '../utils/parsers/parseString';
import { parseBoolean } from '../utils/parsers/parseBoolean';

dotenv.config();

export const vars = Object.freeze({
    env: parseString(process.env.NODE_ENV, 'develop'),
    port: parseNumber(process.env.PORT, 8000),
    domain: parseString(process.env.DOMAIN, 'http://3.71.35.113:8000'),
    isLocal: parseBoolean(process.env.IS_LOCAL, true),

    redis: {
        uri: parseString(process.env.REDIS_URI, 'redis://default:VDoJXa5maUdu8F1mDhgGW2bbEsWjCLj8@redis-10765.crce198.eu-central-1-3.ec2.redns.redis-cloud.com:10765'),
    },
    twilio: {
        accountSid: parseString(process.env.TWILIO_ACCOUNT_SID, ''),
        authToken: parseString(process.env.TWILIO_AUTH_TOKEN, ''),
    },
    fallbackPhoneNumber: parseString(process.env.FALLBACK_PHONE_NUMBER, ''),
});
