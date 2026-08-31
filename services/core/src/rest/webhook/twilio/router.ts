import { Router } from 'express';
import * as controller from './controller';

const twilioRouter = Router();

twilioRouter.post(
    '/departmentCodeRequest',
    controller.departmentCodeRequest,
);

twilioRouter.post(
    '/departmentCodeValidation',
    controller.departmentCodeValidation,
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
