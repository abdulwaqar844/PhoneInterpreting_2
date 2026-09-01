import { toZonedTime } from 'date-fns-tz';
import { and, eq, or } from 'drizzle-orm';
import { mediator, Languages } from '../../models';
import { db } from '../../config/postgres';
import { weekDayTimeSlot } from '../../const/interpreter/weekDayTimeSlot';
import { logger } from '../../config/logger';

interface IArgs {
  priority: number;
  languageCode: number;
}

export const getInterpreters = async ({ priority, languageCode }: IArgs) => {
  // Fetch the language from the database
  const languageRecord = await db
    .select({
      languageName: Languages.id,
      language: Languages.language_code,
      languageCode: Languages.language_name,
    })
    .from(Languages)
    .where(eq(Languages.language_code, languageCode))
    .limit(1);

  if (languageRecord.length === 0) {
    throw new Error('Language not found');
  }
  const languageToUse = languageRecord[0].languageName;
  const languageSelection = [
    eq(mediator.targetLanguage1, languageToUse),
    // eq(mediator.targetLanguage2, languageToUse),
    // eq(mediator.targetLanguage3, languageToUse),
    // eq(mediator.targetLanguage4, languageToUse),
  ];
  const dateNow = toZonedTime(new Date(), 'Europe/Rome');
  const currentWeekDay = dateNow.getDay();
  const timeSlotToUse = weekDayTimeSlot[currentWeekDay];
  const interpreters = await db
    .select({
      id: mediator.id,
      email: mediator.email,
      firstName: mediator.firstName,
      lastName: mediator.lastName,
      phone: mediator.phone,
      priority: mediator.priority,
      timeSlot: mediator[timeSlotToUse],
    })
    .from(mediator)
    .where(
      and(eq(mediator.priority, String(priority)), or(...languageSelection)),
    );
  const filteredInterpreters = interpreters.filter((interpreter) => {
    const { timeSlot } = interpreter;

    if (!timeSlot) {
      return false;
    }

    const slots = timeSlot.split(',');

    return slots.some((slot) => {
      const [start, end] = slot.split('-');

      const now = toZonedTime(new Date(), 'Europe/Rome');

      const slotStart = new Date(now);
      const slotEnd = new Date(now);

      const [startHours, startMinutes] = start.split(':').map(Number);
      const [endHours, endMinutes] = end.split(':').map(Number);

      slotStart.setHours(startHours, startMinutes, 0, 0);
      slotEnd.setHours(endHours, endMinutes, 0, 0);

      // Overnight slot handling
      if (slotEnd <= slotStart) {
        slotEnd.setDate(slotEnd.getDate() + 1);

        // If current time is after midnight
        if (now < slotStart) {
          now.setDate(now.getDate() + 1);
        }
      }

      return now >= slotStart && now <= slotEnd;
    });
  });
  logger.info(`Filtered interpreters: ${JSON.stringify(filteredInterpreters)}`);
  return filteredInterpreters;
};
