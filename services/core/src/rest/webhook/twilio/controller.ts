import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

import { getInterpreters } from '../../../services/interpreter/getInterpreters';
import { languageExists } from '../../../services/language/languageExists';

import { convertMiddlewareToAsync } from '../../../utils/rest/middlewares/convertMiddlewareToAsync';

import { TWILIO_WEBHOOK } from '../../../const/http/ApiUrl';

import { twilioClient } from '../../../config/twilio';
import { redisClient } from '../../../config/redis';
import { vars } from '../../../config/vars';
import { logger } from '../../../config/logger';

const removeAndCallNewTargets = async ({
  originCallId,
  targetCallId,
  langaugeCode,
  priority,
  fallbackCalled,
}: {
  originCallId: string;
  targetCallId: string;
  langaugeCode: number;
  priority: number;
  fallbackCalled: boolean;
}) => {
  const originCall = await twilioClient.calls(originCallId).fetch();

  if (
    originCall.status === 'completed' ||
    originCall.status === 'canceled' ||
    originCall.status === 'busy' ||
    originCall.status === 'failed' ||
    originCall.status === 'no-answer'
  ) {
    twilioClient.calls(targetCallId).update({
      status: 'completed',
    });

    return;
  }

  if (fallbackCalled) {
    twilioClient.calls(originCallId).update({
      url: `${TWILIO_WEBHOOK}/noAnswer`,
      method: 'POST',
    });
    return;
  }

  await redisClient.lRem(originCallId, 0, targetCallId);
  const isAllNumbersUnavailable = !(await redisClient.exists(originCallId));

  if (!isAllNumbersUnavailable) {
    return;
  }

  let interpreters = [];
  let currentPriority = priority;
  let currentFallbackCalled: boolean = fallbackCalled;

  do {
    // eslint-disable-next-line no-await-in-loop
    interpreters = await getInterpreters({
      priority: currentPriority,
      languageCode: langaugeCode,
    });
    currentPriority++;
  } while (interpreters.length === 0 && currentPriority <= 5);

  const selectedPriority =
    interpreters.length > 0 ? currentPriority - 1 : currentPriority;

  if (interpreters.length === 0 && currentPriority > 5) {
    if (!vars.fallbackPhoneNumber) {
      logger.error(
        'No interpreters available and fallback phone number is not configured',
      );
      twilioClient.calls(originCallId).update({
        url: `${TWILIO_WEBHOOK}/noAnswer`,
        method: 'POST',
      });
      return;
    }
    currentFallbackCalled = true;
    interpreters = [{ phone: vars.fallbackPhoneNumber }];
  }

  logger.info(
    `Priority: ${selectedPriority}, Fallback called: ${currentFallbackCalled}`,
  );

  // Filter out interpreters without valid phone numbers
  const validInterpreters = interpreters.filter(({ phone }) => {
    if (!phone || phone.trim() === '') {
      logger.warn('Interpreter with missing phone number filtered out');
      return false;
    }
    return true;
  });

  if (validInterpreters.length === 0) {
    logger.error('No interpreters with valid phone numbers available');
    twilioClient.calls(originCallId).update({
      url: `${TWILIO_WEBHOOK}/noAnswer`,
      method: 'POST',
    });
    return;
  }

  await Promise.all(
    validInterpreters.map(async ({ phone }) => {
      logger.info(`Creating call to: ${phone}`);
      const createdCall = await twilioClient.calls.create({
        url:
          `${TWILIO_WEBHOOK}/machineDetectionResult?originCallId=${originCallId}` +
          `&langaugeCode=${langaugeCode}&priority=${selectedPriority}&fallbackCalled=${currentFallbackCalled}`,
        to: phone,
        from: '+39800826523',
        machineDetection: 'Enable',
        machineDetectionTimeout: 10,
        statusCallback:
          `${TWILIO_WEBHOOK}/callStatusResult?originCallId=${originCallId}` +
          `&langaugeCode=${langaugeCode}&priority=${selectedPriority}&fallbackCalled=${currentFallbackCalled}`,
        statusCallbackMethod: 'POST',
        timeout: 30,
      });

      await redisClient.lPush(originCallId, createdCall.sid);
    }),
  );
};

export const languageCodeRequest = convertMiddlewareToAsync(
  async (req, res) => {
    const requestStartedAt = Date.now();
    const twiml = new VoiceResponse();
    const originCallId = String(req.body?.CallSid ?? 'unknown');

    const retriesAmount = Number(req.query.retriesAmount ?? 0);
    const errorsAmount = Number(req.query.errorsAmount ?? 0);
    if (retriesAmount >= 2) {
      twiml.say(
        {
          language: 'it-IT',
        },
        'Siamo spiacenti, non è stato possibile elaborare la richiesta. La invitiamo a riprovare più tardi',
      );

      twiml.hangup();

      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    if (errorsAmount >= 3) {
      twiml.say(
        {
          language: 'it-IT',
        },
        'Sono stati effettuati troppi tentativi non validi.' +
          "La invitiamo a contattare l'assistenza o riprovare più tardi",
      );

      twiml.hangup();

      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    const gather = twiml.gather({
      numDigits: 2,
      timeout: 15,
      action:
        `./languageCodeValidation?retriesAmount=${retriesAmount}` +
        `&errorsAmount=${errorsAmount + 1}&actionRetry=true`,
    });

    const actionRetry = Boolean(req.query.actionRetry);
    const actionError = Boolean(req.query.actionError);

    let phraseToSay = 'Inserire ora il codice della lingua richiesta';

    if (actionRetry) {
      phraseToSay =
        'Non abbiamo ricevuto alcun input. Inserisca il codice adesso, per favore';
    }

    if (actionError) {
      phraseToSay =
        'Il codice lingua inserito non è valido. Si prega di riprovare';
    }

    gather.say(
      {
        language: 'it-IT',
      },
      phraseToSay,
    );

    twiml.redirect(
      `./languageCodeRequest?retriesAmount=${retriesAmount}&errorsAmount=${
        errorsAmount + 1
      }`,
    );

    res.type('text/xml');
    res.send(twiml.toString());
    logger.info(
      `[Twilio][${originCallId}] languageCodeRequest completed in ${Date.now() - requestStartedAt}ms ` +
        `(retries=${retriesAmount}, errors=${errorsAmount}, actionRetry=${actionRetry}, actionError=${actionError})`,
    );
  },
);

export const languageCodeValidation = convertMiddlewareToAsync(
  async (req, res) => {
    const requestStartedAt = Date.now();
    const twiml = new VoiceResponse();

    const retriesAmount = Number(req.query.retriesAmount ?? 0);
    const errorsAmount = Number(req.query.errorsAmount ?? 0);
    const languageCode = Number(req.body.Digits);
    const { CallSid: originCallId } = req.body;

    logger.info(
      `[Twilio][${originCallId}] languageCodeValidation received digits=${req.body.Digits} ` +
        `(parsed=${languageCode})`,
    );

    if (languageCode && languageExists({ languageCode })) {
      logger.info(
        `[Twilio][${originCallId}] language code ${languageCode} is valid, saving to Redis`,
      );
      await redisClient.set(`${originCallId}:languageCode`, languageCode);
      twiml.redirect(`./callInterpreter?langaugeCode=${languageCode}`);
      logger.info(
        `[Twilio][${originCallId}] language code saved, redirecting to callInterpreter`,
      );
    } else {
      logger.warn(
        `[Twilio][${originCallId}] invalid language code ${req.body.Digits}, redirecting to retry`,
      );
      twiml.redirect(
        `./languageCodeRequest?retriesAmount=${retriesAmount}` +
          `&errorsAmount=${errorsAmount + 1}&actionError=true`,
      );
    }

    res.type('text/xml');
    res.send(twiml.toString());
    logger.info(
      `[Twilio][${originCallId}] languageCodeValidation completed in ${Date.now() - requestStartedAt}ms`,
    );
  },
);

export const callInterpreter = convertMiddlewareToAsync(async (req, res) => {
  const requestStartedAt = Date.now();
  const twiml = new VoiceResponse();
  const { CallSid: originCallId } = req.body;
  // Store start time in Redis

  const langaugeCode = Number(req.query.langaugeCode);
  let priority = 1;
  let fallbackCalled = false;

  logger.info(
    `[Twilio][${originCallId}] callInterpreter started for language=${langaugeCode}`,
  );

  // Do not let a stale target list from a previous call affect this call
  await redisClient.del(originCallId);

  twiml.dial().conference(
    {
      statusCallback: `${TWILIO_WEBHOOK}/conferenceStatusResult?originCallId=${originCallId}`,
      statusCallbackEvent: ['leave'],
      statusCallbackMethod: 'POST',
      endConferenceOnExit: true,
      maxParticipants: 2,
      record: 'record-from-start',
      waitUrl: `${TWILIO_WEBHOOK}/connecting`,
      waitMethod: 'POST',
    },
    originCallId,
  );

  res.type('text/xml');
  res.send(twiml.toString());
  logger.info(
    `[Twilio][${originCallId}] conference TwiML sent in ${Date.now() - requestStartedAt}ms; starting interpreter lookup`,
  );

  let interpreters = [];

  do {
    const lookupStartedAt = Date.now();
    logger.info(
      `[Twilio][${originCallId}] looking up interpreters for priority=${priority}, language=${langaugeCode}`,
    );
    // eslint-disable-next-line no-await-in-loop
    interpreters = await getInterpreters({
      priority,
      languageCode: langaugeCode,
    });
    logger.info(
      `[Twilio][${originCallId}] interpreter lookup priority=${priority} returned ${interpreters.length} result(s) in ${Date.now() - lookupStartedAt}ms`,
    );
    priority++;
  } while (interpreters.length === 0 && priority <= 5);

  if (interpreters.length === 0 && priority > 5) {
    if (!vars.fallbackPhoneNumber) {
      logger.error(
        'No interpreters available and fallback phone number is not configured',
      );
      // Redirect to no answer message
      await twilioClient.calls(originCallId).update({
        url: `${TWILIO_WEBHOOK}/noAnswer`,
        method: 'POST',
      });
      return;
    }
    fallbackCalled = true;
    interpreters = [{ phone: vars.fallbackPhoneNumber }];
  }

  const selectedPriority = interpreters.length > 0 ? priority - 1 : priority;

  logger.info(
    `Priority: ${selectedPriority}, Fallback called: ${fallbackCalled}`,
  );

  // Filter out interpreters without valid phone numbers
  const validInterpreters = interpreters.filter(({ phone }) => {
    if (!phone || phone.trim() === '') {
      logger.warn('Interpreter with missing phone number filtered out');
      return false;
    }
    return true;
  });

  if (validInterpreters.length === 0) {
    logger.error('No interpreters with valid phone numbers available');
    await twilioClient.calls(originCallId).update({
      url: `${TWILIO_WEBHOOK}/noAnswer`,
      method: 'POST',
    });
    return;
  }

  await Promise.all(
    validInterpreters.map(async ({ phone }) => {
      const callStartedAt = Date.now();
      logger.info(
        `[Twilio][${originCallId}] creating outbound mediator call to ${phone}`,
      );
      const createdCall = await twilioClient.calls.create({
        url:
          `${TWILIO_WEBHOOK}/machineDetectionResult?originCallId=${originCallId}` +
          `&langaugeCode=${langaugeCode}&priority=${selectedPriority}&fallbackCalled=${fallbackCalled}`,
        to: phone,
        from: '+39800826523',
        machineDetection: 'Enable',
        machineDetectionTimeout: 10,
        statusCallback:
          `${TWILIO_WEBHOOK}/callStatusResult?originCallId=${originCallId}` +
          `&langaugeCode=${langaugeCode}&priority=${selectedPriority}&fallbackCalled=${fallbackCalled}`,
        statusCallbackMethod: 'POST',
        // 15 seconds is often consumed by carrier setup and answering-machine
        // detection, leaving the mediator almost no time to answer
        timeout: 30,
      });

      // Store each SID as soon as it is created. Status callbacks can arrive
      // before all calls in the batch have finished being created.
      await redisClient.lPush(originCallId, createdCall.sid);
      logger.info(
        `[Twilio][${originCallId}] outbound mediator call created sid=${createdCall.sid} in ${Date.now() - callStartedAt}ms`,
      );
    }),
  );

  logger.info(
    `[Twilio][${originCallId}] callInterpreter finished interpreter dispatch in ${Date.now() - requestStartedAt}ms`,
  );
});

export const machineDetectionResult = convertMiddlewareToAsync(
  async (req, res) => {
    const { AnsweredBy, CallSid: targetCallId } = req.body;
    const originCallId = String(req.query.originCallId ?? '');
    const langaugeCode = Number(req.query.langaugeCode);
    const priority = Number(req.query.priority);
    const fallbackCalled = req.query.fallbackCalled === 'true';

    if (AnsweredBy === 'unknown' || AnsweredBy === 'human') {
      const twiml = new VoiceResponse();
      twiml.dial().conference(originCallId);
      res.type('text/xml');
      res.send(twiml.toString());

      const interpretersCallsSid = await redisClient.lRange(
        originCallId,
        0,
        -1,
      );
      const filteredInterpretersCallsSid = interpretersCallsSid.filter(
        (interpreterCallSid) => interpreterCallSid !== targetCallId,
      );

      await Promise.all(
        filteredInterpretersCallsSid.map((interpreterCallSid) => {
          return twilioClient.calls(interpreterCallSid).update({
            status: 'completed',
          });
        }),
      );
    } else {
      res.sendStatus(204);

      await twilioClient.calls(targetCallId).update({
        status: 'completed',
      });
      await removeAndCallNewTargets({
        originCallId,
        targetCallId,
        langaugeCode,
        priority,
        fallbackCalled,
      });
    }
  },
);

export const callStatusResult = convertMiddlewareToAsync(async (req, res) => {
  const { CallSid: targetCallId, CallStatus } = req.body;
  res.sendStatus(204);

  const originCallId = String(req.query.originCallId ?? '');
  const langaugeCode = Number(req.query.langaugeCode);
  const priority = Number(req.query.priority);
  const fallbackCalled = req.query.fallbackCalled === 'true';
  logger.info(
    `Logs in call Status Result: ${CallStatus}, ${targetCallId}, ${originCallId}
    ${new Date().toISOString()} , ${req.body?.ErrorMessage ?? ''},
    ${req.query.fallbackCalled}, ${req.query.languageCode}
    `,
  );

  if (
    CallStatus === 'failed' ||
    CallStatus === 'no-answer' ||
    CallStatus === 'canceled' ||
    CallStatus === 'busy'
  ) {
    await removeAndCallNewTargets({
      originCallId,
      targetCallId,
      langaugeCode,
      priority,
      fallbackCalled,
    });
  }
});

export const conferenceStatusResult = convertMiddlewareToAsync(
  async (req, res) => {
    res.sendStatus(204);

    const { StatusCallbackEvent } = req.body;
    const originCallId = String(req.query.originCallId ?? '');
    if (StatusCallbackEvent !== 'participant-leave') {
      return;
    }

    const participants = await twilioClient
      .conferences(req.body.ConferenceSid)
      .participants.list();

    await Promise.all(
      participants.map(({ callSid }) =>
        twilioClient.calls(callSid).update({
          status: 'completed',
        }),
      ),
    );

    await Promise.all([
      redisClient.del(originCallId),
      redisClient.del(`${originCallId}:languageCode`),
    ]);
  },
);

export const noAnswer = convertMiddlewareToAsync(async (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say(
    {
      language: 'it-IT',
    },
    'Al momento non sono disponibili interpreti per la lingua selezionata. ' +
      'Si prega di riprovare più tardi',
  );

  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
});

export const connecting = convertMiddlewareToAsync(async (_req, res) => {
  const twiml = new VoiceResponse();

  twiml.say(
    {
      language: 'it-IT',
    },
    'Attendere prego, stiamo collegando un interprete',
  );
  twiml.pause({ length: 8 });
  twiml.redirect(`${TWILIO_WEBHOOK}/connecting`);

  res.type('text/xml');
  res.send(twiml.toString());
});
