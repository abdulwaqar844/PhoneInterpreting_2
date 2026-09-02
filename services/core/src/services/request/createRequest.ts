import { logger } from '../../config/logger';
import { twilioClient } from '../../config/twilio';
import { vars } from '../../config/vars';
import { eq } from 'drizzle-orm';
import { mediator, RequestTable } from '../../models';
import { db } from '../../config/postgres';
import uuidv4 from '../../utils/uuid/uuidv4';
/**
 * Function to create a new entry in the RequestTable.
 * @param values - An object containing key-value pairs to populate the table.
 * @returns The created entry.
 */
export async function createRequest(values: any) {
  try {
    if (
      values.EndConferenceOnExit === 'true' ||
      values.EndConferenceOnExit === true
    ) {
      logger.info('EndConferenceOnExit is true, skipping request creation');
      return;
    }
    const callSID = values?.originCallId;
    const languageKey = values?.languageKey ?? values?.language;
    const callDetails = await twilioClient.calls(callSID).fetch();
    logger.info(`values: ${JSON.stringify(values)}`);
    if (Number(callDetails?.duration) < 60) {
      logger.info(
        `Call duration is ${callDetails?.duration} seconds (less than 1 minute), skipping request creation`,
      );
      return;
    }
    if (callDetails?.toFormatted === vars.fallbackPhoneNumber) {
      logger.info('Call to fallback phone number, skipping request creation');
      return;
    }
    let obj = {
      dateOfMediation: new Date(callDetails?.startTime),
      targetLanguage: languageKey,
      duration: callDetails?.duration ? String(callDetails.duration) : '0',
      status: 'Completato',
      id: uuidv4(),
      mediator: callDetails?.toFormatted,
    };
    const result = await db.insert(RequestTable).values(obj).returning();
    logger.info(`Called No: ${callDetails?.toFormatted}`);
    const mediatorResult = await db
      .select()
      .from(mediator)
      .where(eq(mediator.phone, callDetails?.toFormatted))
      .limit(1);
    logger.info(
      'mediator' +
        mediatorResult[0]?.firstName +
        ' ' +
        mediatorResult[0]?.lastName,
    );
    if (mediatorResult.length === 0) {
      logger.warn('No mediator found for the given phone number');
    }
    return result[0];
  } catch (error) {
    logger.error('Error creating request:', error);
  }
}
