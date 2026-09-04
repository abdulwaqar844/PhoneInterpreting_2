import dotenv from 'dotenv';
import { parseNumber } from '../utils/parsers/parseNumber';
import { parseString } from '../utils/parsers/parseString';
import { parseBoolean } from '../utils/parsers/parseBoolean';

dotenv.config();

export const vars = Object.freeze({
  env: parseString(process.env.NODE_ENV, 'develop'),
  port: parseNumber(process.env.PORT, 8000),
  domain: parseString(process.env.DOMAIN, ''),
  isLocal: parseBoolean(process.env.IS_LOCAL, true),

  redis: {
    uri: parseString(process.env.REDIS_URI, ''),
  },
  twilio: {
    accountSid: parseString(process.env.TWILIO_ACCOUNT_SID, ''),
    authToken: parseString(process.env.TWILIO_AUTH_TOKEN, ''),
    waitMusicUrl: parseString(
      process.env.TWILIO_WAIT_MUSIC_URL,
      'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3',
    ),
  },
  mediationOrderHostUrl: parseString(
    process.env.MEDIATION_ORDER_HOST_URL,
    '',
  ),
  fallbackPhoneNumber: parseString(process.env.FALLBACK_PHONE_NUMBER, ''),
});
