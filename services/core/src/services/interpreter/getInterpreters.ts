import { toZonedTime } from 'date-fns-tz';
import { and, eq, or } from 'drizzle-orm';
import { mediator } from '../../models';
import { db } from '../../config/postgres';
import { redisClient } from '../../config/redis';
import { weekDayTimeSlot } from '../../const/interpreter/weekDayTimeSlot';
import { logger } from '../../config/logger';

interface IArgs {
  priority: number;
  languageKey: string;
}

type InterpreterCandidate = {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  priority: string | null;
  timeSlot: string | null;
};

const INTERPRETER_CACHE_TTL_SECONDS = 24 * 60 * 60;

export const getInterpreters = async ({ priority, languageKey }: IArgs) => {
  const startedAt = Date.now();
  logger.info(
    `[InterpreterLookup] started priority=${priority}, languageKey=${languageKey}`,
  );

  const dateNow = toZonedTime(new Date(), 'Europe/Rome');
  const currentWeekDay = dateNow.getDay();
  const timeSlotToUse = weekDayTimeSlot[currentWeekDay];
  const cacheKey =
    `interpreters:${encodeURIComponent(languageKey)}:${priority}:` +
    timeSlotToUse;
  let interpreters: InterpreterCandidate[] | undefined;

  if (redisClient.isReady) {
    try {
      const cachedInterpreters = await redisClient.get(cacheKey);
      if (cachedInterpreters) {
        const parsed = JSON.parse(cachedInterpreters) as unknown;
        if (Array.isArray(parsed)) {
          interpreters = parsed as InterpreterCandidate[];
          logger.info(
            `[InterpreterLookup] Redis cache hit key=${cacheKey} results=${interpreters.length}`,
          );
        }
      }
    } catch (error) {
      logger.warn(
        `[InterpreterLookup] Redis read failed key=${cacheKey}; querying database`,
        error,
      );
    }
  }

  if (!interpreters) {
    const languageSelection = [eq(mediator.targetLanguage1, languageKey)];
    interpreters = await db
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
        and(
          eq(mediator.priority, String(priority)),
          eq(mediator.isActive, true),
          or(...languageSelection),
        ),
      );

    if (redisClient.isReady) {
      try {
        await redisClient.set(
          cacheKey,
          JSON.stringify(interpreters),
          { EX: INTERPRETER_CACHE_TTL_SECONDS },
        );
      } catch (error) {
        logger.warn(
          `[InterpreterLookup] Redis write failed key=${cacheKey}`,
          error,
        );
      }
    }
  }

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
  logger.info(
    `[InterpreterLookup] completed priority=${priority}, languageKey=${languageKey}, ` +
      `databaseResults=${interpreters.length}, availableResults=${filteredInterpreters.length}, ` +
      `duration=${Date.now() - startedAt}ms`,
  );
  return filteredInterpreters;
};
