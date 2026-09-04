import { Router } from 'express';
import * as controller from './controller';
import * as cacheController from './cacheController';

const twilioRouter = Router();

twilioRouter.post(
    '/cache/invalidate',
    cacheController.invalidateCache,
);

twilioRouter.post(
    '/pinCodeRequest',
    controller.pinCodeRequest,
);

twilioRouter.post(
    '/pinCodeValidation',
    controller.pinCodeValidation,
);

twilioRouter.post(
    '/languageCodeRequest',
    controller.languageCodeRequest,
);

twilioRouter.post(
    '/languageCodeValidation',
    controller.languageCodeValidation,
);

twilioRouter.post(
    '/callInterpreter',
    controller.callInterpreter,
);

twilioRouter.post(
    '/connecting',
    controller.connecting,
);

twilioRouter.post(
    '/machineDetectionResult',
    controller.machineDetectionResult,
);

twilioRouter.post(
    '/callStatusResult',
    controller.callStatusResult,
);

twilioRouter.post(
    '/conferenceStatusResult',
    controller.conferenceStatusResult,
);

twilioRouter.post(
    '/noAnswer',
    controller.noAnswer,
);

export { twilioRouter };
