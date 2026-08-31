import { Router } from 'express';
import { twilioRouter } from './twilio/router';

const webhookRoutes = Router();

webhookRoutes.use('/twilio', twilioRouter);

export { webhookRoutes };
