/* eslint-disable indent */
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { Response } from 'express';
import { eq } from 'drizzle-orm';

import { getInterpreters } from '../../../services/interpreter/getInterpreters';
import {
  // eslint-disable-next-line @typescript-eslint/indent
  getLanguageId,
  getLanguageKey,
  getSupportedLanguageNames,
} from '../../../const/language/languageReference';

import { convertMiddlewareToAsync } from '../../../utils/rest/middlewares/convertMiddlewareToAsync';

import { TWILIO_WEBHOOK } from '../../../const/http/ApiUrl';

import { twilioClient } from '../../../config/twilio';
import { redisClient } from '../../../config/redis';
import { vars } from '../../../config/vars';
import { logger } from '../../../config/logger';
import { DEFAULT_CLIENT, getClientPin } from '../../../const/client/clientPins';
import { db } from '../../../config/postgres';
import { mediator } from '../../../models';

const CREATE_MEDIATION_ORDER_MUTATION = `
  mutation CreateMediationOrder($details: mediationCallDetails!) {
    createMediationOrderFromCall(mediationCallDetails: $details) {
      id
    }
  }
`;

type MediationOrderDetails = {
  originCallId: string;
  conferenceSid: string;
  callerPhone: string;
  language: string;
  mediatorCallSid: string;
  mediatorPhone: string;
  mediatorEmail: string | null;
  callStartedAt: string;
  callEndedAt: string;
  durationSeconds: number;
  conferenceStatus: string;
};

const submitMediationOrder = async (details: MediationOrderDetails) => {
  if (!vars.mediationOrderHostUrl) {
    throw new Error('MEDIATION_ORDER_HOST_URL is not configured');
  }

  const response = await fetch(vars.mediationOrderHostUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: CREATE_MEDIATION_ORDER_MUTATION,
      variables: { details },
    }),
  });

  const result = await response.json() as {
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || result.errors?.length) {
    const message = result.errors?.map(({ message }) => message).join('; ');
    throw new Error(
      `Mediation order request failed (${response.status})${message ? `: ${message}` : ''}`,
    );
  }
};

const saveCompletedConferenceOrder = async ({
  originCallId,
  conferenceSid,
  languageKey,
  conferenceStatus,
  fallbackCalled,
}: {
  originCallId: string;
  conferenceSid: string;
  languageKey: string;
  conferenceStatus: string;
  fallbackCalled: boolean;
}) => {
  if (fallbackCalled) {
    logger.info(
      `[Twilio][${originCallId}] fallback call completed; mediation order not submitted`,
    );
    return;
  }

  const mediatorCallSid = await redisClient.get(
    `${originCallId}:mediatorCallSid`,
  );

  if (!mediatorCallSid) {
    logger.info(
      `[Twilio][${originCallId}] no connected mediator found; mediation order not submitted`,
    );
    return;
  }

  const orderLockKey = `${originCallId}:mediationOrderSubmitted`;
  const lock = await redisClient.set(orderLockKey, 'processing', {
    NX: true,
    EX: 24 * 60 * 60,
  });

  if (lock !== 'OK') {
    logger.info(
      `[Twilio][${originCallId}] mediation order already submitted or in progress`,
    );
    return;
  }

  try {
    const [originCall, mediatorCall] = await Promise.all([
      twilioClient.calls(originCallId).fetch(),
      twilioClient.calls(mediatorCallSid).fetch(),
    ]);
    const mediatorPhone = mediatorCall.to;
    const mediatorResult = await db
      .select({ email: mediator.email })
      .from(mediator)
      .where(eq(mediator.phone, mediatorPhone))
      .limit(1);
    const callEndedAt = originCall.endTime ?? new Date();
    const durationSeconds = Number(originCall.duration ?? 0);

    await submitMediationOrder({
      originCallId,
      conferenceSid,
      callerPhone: originCall.from,
      language: languageKey,
      mediatorCallSid,
      mediatorPhone,
      mediatorEmail: mediatorResult[0]?.email ?? null,
      callStartedAt: (originCall.startTime ?? callEndedAt).toISOString(),
      callEndedAt: callEndedAt.toISOString(),
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      conferenceStatus,
    });

    logger.info(
      `[Twilio][${originCallId}] mediation order submitted conferenceSid=${conferenceSid} mediatorCallSid=${mediatorCallSid}`,
    );
  } catch (error) {
    await redisClient.del(orderLockKey);
    throw error;
  }
};

const removeAndCallNewTargets = async ({
  originCallId,
  targetCallId,
  languageKey,
  priority,
  fallbackCalled,
}: {
  originCallId: string;
  targetCallId: string;
  languageKey: string;
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
      languageKey,
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
          `&languageKey=${encodeURIComponent(languageKey)}&priority=${selectedPriority}&fallbackCalled=${currentFallbackCalled}`,
        to: phone,
        from: '+15085700966',
        machineDetection: 'Enable',
        machineDetectionTimeout: 10,
        statusCallback:
          `${TWILIO_WEBHOOK}/callStatusResult?originCallId=${originCallId}` +
          `&languageKey=${encodeURIComponent(languageKey)}&priority=${selectedPriority}&fallbackCalled=${currentFallbackCalled}`,
        statusCallbackMethod: 'POST',
        timeout: 40,
      });

      await redisClient.lPush(originCallId, createdCall.sid);
    }),
  );
};

const sendHangupResponse = (res: Response, twiml: VoiceResponse) => {
  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
};

const sendLanguageErrorResponse = (res: Response, twiml: VoiceResponse) => {
  twiml.say(
    { language: 'it-IT' },
    "Siamo spiacenti, la lingua richiesta non è stata riconosciuta oppure non è attualmente supportata. Ti invitiamo a riprovare con un'altra lingua.",
  );
  sendHangupResponse(res, twiml);
};

const sendFallbackResponse = (
  res: Response,
  twiml: VoiceResponse,
  fallbackPhoneNumber: string,
) => {
  twiml.say(
    { language: 'it-IT' },
    'Nessun interprete disponibile per la lingua richiesta. Attendi in linea. Ti stiamo collegando a un operatore.',
  );
  twiml.dial(fallbackPhoneNumber);
  res.type('text/xml');
  res.send(twiml.toString());
};

const MAX_LANGUAGE_ATTEMPTS = 2;

const MAX_PIN_ATTEMPTS = 2;

export const pinCodeRequest = convertMiddlewareToAsync(async (req, res) => {
  const twiml = new VoiceResponse();
  const originCallId = String(req.body?.CallSid ?? 'unknown');
  const client = String(req.query.client ?? DEFAULT_CLIENT);
  const attempt = Number(req.query.attempt ?? 0);

  logger.info(
    `[Twilio][${originCallId}] requesting PIN for client=${client}, attempt=${attempt + 1}/${MAX_PIN_ATTEMPTS}`,
  );

  if (attempt === 0) {
    twiml.say(
      { language: 'it-IT' },
      'Benvenuto nel servizio di phone interpreting per ASST LARIANA.',
    );
  }

  const gather = twiml.gather({
    input: ['dtmf'],
    numDigits: 3,
    timeout: 5,
    action:
      `${TWILIO_WEBHOOK}/pinCodeValidation?client=${encodeURIComponent(client)}` +
      `&attempt=${Number.isFinite(attempt) ? attempt : 0}`,
    method: 'POST',
  });
  gather.say(
    { language: 'it-IT' },
    attempt > 0
      ? 'Il PIN inserito non è corretto. Inseriscilo nuovamente.'
      : 'Inserisci il tuo codice PIN di tre cifre.',
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

export const pinCodeValidation = convertMiddlewareToAsync(async (req, res) => {
  const twiml = new VoiceResponse();
  const originCallId = String(req.body?.CallSid ?? 'unknown');
  const client = String(req.query.client ?? DEFAULT_CLIENT);
  const attempt = Number(req.query.attempt ?? 0);
  const enteredPin = String(req.body?.Digits ?? '');
  const expectedPin = getClientPin(client);

  if (expectedPin && enteredPin === expectedPin) {
    logger.info(`[Twilio][${originCallId}] PIN validated for client=${client}`);
    twiml.redirect(`${TWILIO_WEBHOOK}/languageCodeRequest`);
    res.type('text/xml');
    res.send(twiml.toString());
    return;
  }

  if (Number.isFinite(attempt) && attempt < MAX_PIN_ATTEMPTS - 1) {
    const nextAttempt = attempt + 1;
    logger.warn(
      `[Twilio][${originCallId}] invalid PIN for client=${client}; requesting retry ${nextAttempt + 1}/${MAX_PIN_ATTEMPTS}`,
    );
    twiml.redirect(
      `${TWILIO_WEBHOOK}/pinCodeRequest?client=${encodeURIComponent(client)}` +
        `&attempt=${nextAttempt}`,
    );
  } else if (vars.fallbackPhoneNumber) {
    logger.warn(
      `[Twilio][${originCallId}] PIN validation failed after ${MAX_PIN_ATTEMPTS} attempts; routing to fallback`,
    );
    sendFallbackResponse(res, twiml, vars.fallbackPhoneNumber);
    return;
  } else {
    logger.warn(
      `[Twilio][${originCallId}] PIN validation failed and fallback is unavailable; hanging up`,
    );
    sendLanguageErrorResponse(res, twiml);
    return;
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

export const languageCodeRequest = convertMiddlewareToAsync(
  async (req, res) => {
    const requestStartedAt = Date.now();
    const twiml = new VoiceResponse();
    const originCallId = String(req.body?.CallSid ?? 'unknown');
    const attempt = Number(req.query.attempt ?? 0);
    const isRetry = Number.isFinite(attempt) && attempt > 0;

    try {
      const supportedLanguageNames = await getSupportedLanguageNames();
      const gather = twiml.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        timeout: 5,
        action:
          `${TWILIO_WEBHOOK}/languageCodeValidation?attempt=` +
          `${Number.isFinite(attempt) ? attempt : 0}`,
        method: 'POST',
        hints: supportedLanguageNames.join(','),
      });
      gather.say(
        { language: 'it-IT' },
        isRetry
          ? 'Non abbiamo riconosciuto la lingua richiesta. Indica nuovamente la lingua di cui hai bisogno.'
          : 'Indica la lingua per la quale hai bisogno di un interprete.',
      );
    } catch (error) {
      logger.error(
        `[Twilio][${originCallId}] language list lookup failed`,
        error,
      );
      if (vars.fallbackPhoneNumber) {
        twiml.say(
          { language: 'it-IT' },
          'Nessun interprete disponibile per la lingua richiesta. Attendi in linea. Ti stiamo collegando a un operatore.',
        );
        twiml.dial(vars.fallbackPhoneNumber);
      } else {
        twiml.redirect(`${TWILIO_WEBHOOK}/noAnswer`);
      }
    }

    res.type('text/xml');
    res.send(twiml.toString());
    logger.info(
      `[Twilio][${originCallId}] languageCodeRequest completed in ${Date.now() - requestStartedAt}ms ` +
        '(speech language prompt sent)',
    );
  },
);

export const languageCodeValidation = convertMiddlewareToAsync(
  async (req, res) => {
    const requestStartedAt = Date.now();
    const twiml = new VoiceResponse();
    logger.info(
      `[Twilio][${req.body?.CallSid ?? 'unknown'}] languageCodeValidation started`,
    );
    const spokenLanguage = req.body.SpeechResult;
    const { CallSid: originCallId } = req.body;
    const attempt = Number(req.query.attempt ?? 0);
    let languageKey: string | undefined;
    let languageLookupFailed = false;
    try {
      languageKey = await getLanguageKey(spokenLanguage);
    } catch (error) {
      languageLookupFailed = true;
      logger.error(
        `[Twilio][${originCallId}] language lookup failed; hanging up`,
        error,
      );
    }
    logger.info(
      `[Twilio][${originCallId}] language recognition received "${spokenLanguage ?? ''}" ` +
        `(parsed=${languageKey ?? 'unsupported'})`,
    );

    if (languageKey) {
      logger.info(
        `[Twilio][${originCallId}] language key ${languageKey} is valid, saving to Redis`,
      );
      try {
        await redisClient.set(`${originCallId}:languageKey`, languageKey);
      } catch (error) {
        logger.error(
          `[Twilio][${originCallId}] failed to save language, hanging up`,
          error,
        );
        sendLanguageErrorResponse(res, twiml);
        return;
      }
      twiml.say(
        { language: 'it-IT' },
        `Grazie. Hai richiesto un interprete di lingua ${languageKey}. Resta in attesa mentre effettuiamo il collegamento.`,
      );
      twiml.redirect(
        `./callInterpreter?languageKey=${encodeURIComponent(languageKey)}`,
      );
      logger.info(
        `[Twilio][${originCallId}] language code saved, redirecting to callInterpreter`,
      );
    } else {
      if (
        !languageLookupFailed &&
        Number.isFinite(attempt) &&
        attempt < MAX_LANGUAGE_ATTEMPTS - 1
      ) {
        const nextAttempt = attempt + 1;
        logger.warn(
          `[Twilio][${originCallId}] unsupported or missing language, requesting retry ${nextAttempt}/${MAX_LANGUAGE_ATTEMPTS}`,
        );
        twiml.redirect(
          `${TWILIO_WEBHOOK}/languageCodeRequest?attempt=${nextAttempt}`,
        );
      } else {
        logger.warn(
          `[Twilio][${originCallId}] unsupported or missing language after ${MAX_LANGUAGE_ATTEMPTS} attempts, routing to fallback`,
        );
        if (vars.fallbackPhoneNumber) {
          sendFallbackResponse(res, twiml, vars.fallbackPhoneNumber);
        } else {
          sendLanguageErrorResponse(res, twiml);
        }
      }
      logger.info(
        `[Twilio][${originCallId}] languageCodeValidation completed in ${Date.now() - requestStartedAt}ms`,
      );
      return;
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
  const languageKey = String(req.query.languageKey ?? '');
  let priority = 1;
  let fallbackCalled = false;

  logger.info(
    `[Twilio][${originCallId}] callInterpreter started for language=${languageKey}`,
  );

  let interpreters = [];

  try {
    if (!languageKey) {
      logger.warn(`[Twilio][${originCallId}] no language provided, hanging up`);
      sendLanguageErrorResponse(res, twiml);
      return;
    }

    if (!(await getLanguageId(languageKey))) {
      logger.warn(
        `[Twilio][${originCallId}] unsupported language=${languageKey}, hanging up`,
      );
      sendLanguageErrorResponse(res, twiml);
      return;
    }

    do {
      const lookupStartedAt = Date.now();
      logger.info(
        `[Twilio][${originCallId}] looking up interpreters for priority=${priority}, language=${languageKey}`,
      );
      // eslint-disable-next-line no-await-in-loop
      interpreters = await getInterpreters({
        priority,
        languageKey,
      });
      logger.info(
        `[Twilio][${originCallId}] interpreter lookup priority=${priority} returned ${interpreters.length} result(s) in ${Date.now() - lookupStartedAt}ms`,
      );
      priority++;
    } while (interpreters.length === 0 && priority <= 5);
  } catch (error) {
    logger.error(
      `[Twilio][${originCallId}] interpreter lookup failed, hanging up`,
      error,
    );
    sendHangupResponse(res, twiml);
    return;
  }

  if (interpreters.length === 0 && priority > 5) {
    if (!vars.fallbackPhoneNumber) {
      logger.error(
        `[Twilio][${originCallId}] no interpreters available, hanging up`,
      );
      sendHangupResponse(res, twiml);
      return;
    }
    fallbackCalled = true;
    interpreters = [{ phone: vars.fallbackPhoneNumber }];
  }

  // Do not let a stale target list from a previous call affect this call.
  try {
    await redisClient.del(originCallId);
  } catch (error) {
    logger.error(
      `[Twilio][${originCallId}] failed to clear call state, hanging up`,
      error,
    );
    sendHangupResponse(res, twiml);
    return;
  }

  twiml.dial().conference(
    {
      statusCallback:
        `${TWILIO_WEBHOOK}/conferenceStatusResult?originCallId=${originCallId}` +
        `&languageKey=${encodeURIComponent(languageKey)}&fallbackCalled=${fallbackCalled}`,
      statusCallbackEvent: ['leave'],
      statusCallbackMethod: 'POST',
      endConferenceOnExit: true,
      maxParticipants: 2,
      waitUrl:
        `${TWILIO_WEBHOOK}/connecting?languageKey=` +
        encodeURIComponent(languageKey),
      waitMethod: 'POST',
    },
    originCallId,
  );

  res.type('text/xml');
  res.send(twiml.toString());
  logger.info(
    `[Twilio][${originCallId}] conference TwiML sent in ${Date.now() - requestStartedAt}ms; starting interpreter lookup`,
  );

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
          `&languageKey=${encodeURIComponent(languageKey)}&priority=${selectedPriority}&fallbackCalled=${fallbackCalled}`,
        to: phone,
        from: '+15085700966',
        machineDetection: 'Enable',
        machineDetectionTimeout: 10,
        statusCallback:
          `${TWILIO_WEBHOOK}/callStatusResult?originCallId=${originCallId}` +
          `&languageKey=${encodeURIComponent(languageKey)}&priority=${selectedPriority}&fallbackCalled=${fallbackCalled}`,
        statusCallbackMethod: 'POST',
        // 15 seconds is often consumed by carrier setup and answering-machine
        // detection, leaving the mediator almost no time to answer
        timeout: 40,
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
    const languageKey = String(req.query.languageKey ?? '');
    const priority = Number(req.query.priority);
    const fallbackCalled = req.query.fallbackCalled === 'true';

    if (AnsweredBy === 'unknown' || AnsweredBy === 'human') {
      const twiml = new VoiceResponse();
      twiml.dial().conference(originCallId);
      res.type('text/xml');
      res.send(twiml.toString());

      if (!fallbackCalled) {
        try {
          await redisClient.set(
            `${originCallId}:mediatorCallSid`,
            targetCallId,
            { EX: 24 * 60 * 60 },
          );
        } catch (error) {
          logger.warn(
            `[Twilio][${originCallId}] failed to save connected mediator SID`,
            error,
          );
        }
      }

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
      const twiml = new VoiceResponse();
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());

      await twilioClient.calls(targetCallId).update({
        status: 'completed',
      });
      await removeAndCallNewTargets({
        originCallId,
        targetCallId,
        languageKey,
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
  const languageKey = String(req.query.languageKey ?? '');
  const priority = Number(req.query.priority);
  const fallbackCalled = req.query.fallbackCalled === 'true';
  logger.info(
    `Logs in call Status Result: ${CallStatus}, ${targetCallId}, ${originCallId}
    ${new Date().toISOString()} , ${req.body?.ErrorMessage ?? ''},
    ${req.query.fallbackCalled}, ${languageKey}
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
      languageKey,
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
    const languageKey = String(req.query.languageKey ?? '');
    const fallbackCalled = req.query.fallbackCalled === 'true';
    const conferenceSid = String(req.body?.ConferenceSid ?? '');
    logger.info(
      `[Twilio][${originCallId}] conference status callback received: ` +
        `event=${StatusCallbackEvent ?? 'unknown'}, conferenceSid=${conferenceSid}`,
    );

    if (
      StatusCallbackEvent !== 'leave' &&
      StatusCallbackEvent !== 'participant-leave'
    ) {
      return;
    }

    const participants = await twilioClient
      .conferences(conferenceSid)
      .participants.list();

    if (!fallbackCalled && languageKey && conferenceSid) {
      try {
        await saveCompletedConferenceOrder({
          originCallId,
          conferenceSid,
          languageKey,
          fallbackCalled,
          conferenceStatus: String(
            req.body?.ConferenceStatus ?? StatusCallbackEvent ?? 'completed',
          ),
        });
      } catch (error) {
        logger.error(
          `[Twilio][${originCallId}] failed to submit mediation order`,
          error,
        );
      }
    }

    await Promise.all(
      participants.map(({ callSid }) =>
        twilioClient.calls(callSid).update({
          status: 'completed',
        }),
      ),
    );

    await Promise.all([
      redisClient.del(originCallId),
      redisClient.del(`${originCallId}:languageKey`),
      redisClient.del(`${originCallId}:mediatorCallSid`),
    ]);
  },
);

export const noAnswer = convertMiddlewareToAsync(async (_req, res) => {
  const twiml = new VoiceResponse();
  sendHangupResponse(res, twiml);
});

export const connecting = convertMiddlewareToAsync(async (req, res) => {
  const twiml = new VoiceResponse();
  const languageKey = String(req.query.languageKey ?? 'the requested language');

  twiml.say(
    {
      language: 'it-IT',
    },
    `La ricerca di un interprete di lingua ${languageKey} è ancora in corso. Rimani in linea.`,
  );
  twiml.play({ loop: 1 }, vars.twilio.waitMusicUrl);
  twiml.redirect(
    `${TWILIO_WEBHOOK}/connecting?languageKey=${encodeURIComponent(languageKey)}`,
  );

  res.type('text/xml');
  res.send(twiml.toString());
});
