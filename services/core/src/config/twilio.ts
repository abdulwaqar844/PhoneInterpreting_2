import twilio from 'twilio';
import { vars } from './vars';

const {
    twilio: {
        accountSid,
        authToken,
    },
} = vars;

export const twilioClient = twilio(accountSid, authToken);
