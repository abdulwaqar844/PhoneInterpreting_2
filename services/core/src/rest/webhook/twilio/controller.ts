/* eslint-disable indent */
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { Response } from 'express';

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
        timeout: 30,
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
    { language: 'en-US' },
    'Sorry, we could not recognize or support that language. Please try again later.',
  );
  sendHangupResponse(res, twiml);
};

export const languageCodeRequest = convertMiddlewareToAsync(
  async (req, res) => {
    const requestStartedAt = Date.now();
    const twiml = new VoiceResponse();
    const originCallId = String(req.body?.CallSid ?? 'unknown');

    try {
      const supportedLanguageNames = await getSupportedLanguageNames();
      const gather = twiml.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        timeout: 5,
        action: `${TWILIO_WEBHOOK}/languageCodeValidation`,
        method: 'POST',
        hints: supportedLanguageNames.join(','),
      });
      gather.say({ language: 'en-US' }, 'Please say the language you need.');
    } catch (error) {
      logger.error(
        `[Twilio][${originCallId}] language list lookup failed`,
        error,
      );
      if (vars.fallbackPhoneNumber) {
        twiml.say(
          { language: 'en-US' },
          'Please wait while we connect you to an operator.',
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
    let languageKey: string | undefined;
    try {
      languageKey = await getLanguageKey(spokenLanguage);
    } catch (error) {
      logger.error(
        `[Twilio][${originCallId}] language lookup failed; routing to fallback`,
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
      twiml.redirect(
        `./callInterpreter?languageKey=${encodeURIComponent(languageKey)}`,
      );
      logger.info(
        `[Twilio][${originCallId}] language code saved, redirecting to callInterpreter`,
      );
    } else {
      logger.warn(
        `[Twilio][${originCallId}] unsupported or missing language, hanging up`,
      );
      sendLanguageErrorResponse(res, twiml);
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
    const languageKey = String(req.query.languageKey ?? '');
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
      redisClient.del(`${originCallId}:languageKey`),
    ]);
  },
);

export const noAnswer = convertMiddlewareToAsync(async (_req, res) => {
  const twiml = new VoiceResponse();
  sendHangupResponse(res, twiml);
});

export const connecting = convertMiddlewareToAsync(async (_req, res) => {
  const twiml = new VoiceResponse();

  twiml.say(
    {
      language: 'en-US',
    },
    'Please wait while we connect you to an interpreter.',
  );
  twiml.pause({ length: 8 });
  twiml.redirect(`${TWILIO_WEBHOOK}/connecting`);

  res.type('text/xml');
  res.send(twiml.toString());
});
