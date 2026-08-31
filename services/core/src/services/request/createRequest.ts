import { logger } from '../../config/logger';
import { twilioClient } from '../../config/twilio';
import { eq } from 'drizzle-orm';
import {
  Bookings,
  Languages,
  mediator,
  RequestTable,
  Users,
} from '../../models';
import { db } from '../../config/postgres';
import { getDepartmentName } from '../department/departmentExists';
import uuidv4 from '../../utils/uuid/uuidv4';
/**
 * Function to create a new entry in the RequestTable.
 * @param values - An object containing key-value pairs to populate the table.
 * @returns The created entry.
 */
const calculatePrice = (minutes: number, additionalTime: number = 0) => {
  const hourlyRate = 15;
  let totalPrice = 0;

  if (minutes <= 60) {
    if (minutes <= 30) {
      totalPrice = hourlyRate / 2;
    } else {
      totalPrice = hourlyRate;
    }
  } else {
    const perMinuteRate = hourlyRate / 60;
    totalPrice = minutes * perMinuteRate;
  }
  const additionalTimePrice =
    additionalTime > 0 ? (additionalTime / 60) * hourlyRate : 0;
  totalPrice += additionalTimePrice;
  return parseFloat(totalPrice.toFixed(2));
};

export async function createRequest(values: any) {
  try {
    if (
      values.EndConferenceOnExit === 'true' ||
      values.EndConferenceOnExit === true
    ) {
      logger.info('EndConferenceOnExit is true, skipping request creation');
      return;
    }
    const FriendlyName = values?.request?.FriendlyName;
    let callSID = values?.originCallId;
    const departmentCode = values.departmentCode;
    const languageCode = values?.languageCode;
    const callDetails = await twilioClient.calls(callSID).fetch();
    const callFrom = await twilioClient.calls(FriendlyName).fetch();
    const languageRecord = await db
      .select({
        languageCode: Languages.language_code,
        languageName: Languages.language_name,
      })
      .from(Languages)
      .where(eq(Languages.language_code, languageCode))
      .limit(1);
    logger.info(`departmentCode: ${departmentCode}`);
    logger.info(`values: ${JSON.stringify(values)}`);
    const departmentName = getDepartmentName({
      departmentCode: departmentCode,
    });
    const userByDepartment = await db
      .select()
      .from(Users)
      .where(eq(Users.firstName, departmentName))
      .limit(1);
    if (Number(callDetails?.duration) < 60) {
      logger.info(
        `Call duration is ${callDetails?.duration} seconds (less than 1 minute), skipping request creation`,
      );
      return;
    }
    if (callDetails?.toFormatted === '+393513424163') {
      logger.info('Call to fallback phone number, skipping request creation');
      return;
    }
    let obj = {
      mediationType: 'Urgente',
      customer: userByDepartment[0]?.customer[0],
      userId: userByDepartment[0]?.id,
      dateOfRequestCompletion: new Date(callDetails?.startTime),
      applicantFirstName: callFrom?.fromFormatted || '',
      applicantLastName: '',
      applicantEmail: userByDepartment[0]?.email,
      applicantPhone: callFrom?.fromFormatted,
      applicantOtherEmail: [],
      applicantOtherPhone: [],
      mediatorInfo: 'Indifferente',
      preferredMediator: null,
      patientFirstName: callFrom?.fromFormatted,
      patientLastName: '',
      operationalUnits: null,
      structurePavilionAddress: null,
      floor: null,
      office: null,
      dateOfIntervention: new Date(callDetails?.startTime),
      expectedDuration: callDetails?.duration
        ? String(Math.ceil(Math.max(Number(callDetails.duration), 60) / 60))
        : '0',
      patientIndication: null,
      targetLanguage: languageRecord[0]?.languageName,
      motivation: null,
      otherMotivation: null,
      notes: `${callDetails?.toFormatted}`,
      status: 'Completato',
      mediationCategory: 'Telefonica',
      amount: String(
        calculatePrice(
          Math.ceil(Math.max(Number(callDetails.duration), 60) / 60),
        ),
      ),
      id: uuidv4(),
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
    if (mediatorResult.length > 0) {
      const newBooking = {
        id: uuidv4(),
        requestId: result[0].id,
        mediatorId: mediatorResult[0].id,
        mediationType: 'Urgente',
        status: 'Completato',
        deliveryDate: new Date(callDetails?.startTime),
        minutes: String(result[0]?.expectedDuration ?? 0),
        amount: String(result[0]?.amount ?? 0),
        additionalMinutes: String(0),
        notes: '',
        language: result[0]?.targetLanguage,
        dateOfRequestCompletion: result[0]?.dateOfRequestCompletion
          ? new Date(result[0]?.dateOfRequestCompletion)
          : null,
      };
      await db.insert(Bookings).values(newBooking).returning();
    } else {
      logger.warn('No mediator found for the given phone number');
    }
    return result[0];
  } catch (error) {
    logger.error('Error creating request:', error);
  }
}
