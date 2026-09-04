import { db } from '../../config/postgres';
import { redisClient } from '../../config/redis';
import { logger } from '../../config/logger';
import { Languages } from '../../models';

// These aliases cover common speech-recognition variants. The supported
// language names and their canonical values always come from the database.
const aliases: Record<string, string[]> = {
  Arabo: ['arabo', 'arabic', 'العربية'],
  Francese: ['francese', 'français', 'francais', 'french'],
  Ucraino: ['ucraino', 'українська', 'ukrainian'],
  Albanese: ['albanese', 'shqip', 'albanian'],
  Cingalese: ['cingalese', 'sinhala', 'sinhalese'],
  Russo: ['russo', 'русский', 'russian'],
  Romeno: ['romeno', 'rumeno', 'română', 'romana', 'romanian'],
  Moldavo: ['moldavo', 'moldovan'],
  Tedesco: ['tedesco', 'deutsch', 'german'],
  Spagnolo: ['spagnolo', 'español', 'espanol', 'spanish'],
  Hindi: ['hindi'],
  Polacco: ['polacco', 'polish'],
  Cinese: ['cinese', 'chinese', 'mandarin', '中文'],
  Urdu: ['urdu', 'اردو'],
  Portoghese: ['portoghese', 'portuguese', 'português', 'portugues'],
  Bengalese: ['bengalese', 'bengali', 'বাংলা'],
  Pashtu: ['pashtu', 'pashto', 'پښتو'],
  Turco: ['turco', 'turkish'],
  Somalo: ['somalo', 'somali', 'soomaali'],
  Punjabi: ['punjabi', 'ਪੰਜਾਬੀ'],
  Filippino: ['filippino', 'filipino', 'tagalog'],
  Inglese: ['inglese', 'english'],
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

type LanguageRecord = {
  id: string;
  languageName: string;
};

export const LANGUAGE_CACHE_KEY = 'languages:all:v2';
const LANGUAGE_CACHE_TTL_SECONDS = 24 * 60 * 60;

let languageCache: LanguageRecord[] | undefined;
let languageCachePromise: Promise<LanguageRecord[]> | undefined;

const loadLanguages = async (): Promise<LanguageRecord[]> => {
  if (languageCache) return languageCache;
  if (!languageCachePromise) {
    languageCachePromise = (async () => {
      if (redisClient.isReady) {
        try {
          const cachedLanguages = await redisClient.get(LANGUAGE_CACHE_KEY);
          if (cachedLanguages) {
            const parsed = JSON.parse(cachedLanguages) as unknown;
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (language) =>
                  typeof language === 'object' &&
                  language !== null &&
                  typeof (language as LanguageRecord).id === 'string' &&
                  typeof (language as LanguageRecord).languageName === 'string',
              )
            ) {
              languageCache = parsed as LanguageRecord[];
              return languageCache;
            }
          }
        } catch (error) {
          logger.warn('Unable to read language list from Redis; using database', error);
        }
      }

      const rows = await db
        .select({
          id: Languages.id,
          languageName: Languages.language_name,
        })
        .from(Languages)
        .orderBy(Languages.language_name);
      languageCache = rows;

      if (redisClient.isReady) {
        try {
          await redisClient.set(
            LANGUAGE_CACHE_KEY,
            JSON.stringify(rows),
            { EX: LANGUAGE_CACHE_TTL_SECONDS },
          );
        } catch (error) {
          logger.warn('Unable to write language list to Redis', error);
        }
      }

      return rows;
    })()
      .finally(() => {
        languageCachePromise = undefined;
      });
  }
  return languageCachePromise;
};

export const refreshLanguageCache = async () => {
  languageCache = undefined;
  if (redisClient.isReady) {
    await redisClient.del(LANGUAGE_CACHE_KEY);
  }
};

export const getSupportedLanguageNames = async (): Promise<string[]> =>
  (await loadLanguages()).map(({ languageName }) => languageName);

export const getLanguageId = async (
  languageName: string,
): Promise<string | undefined> => {
  const normalizedLanguageName = normalize(languageName);
  return (await loadLanguages()).find(
    ({ languageName: supportedLanguageName }) =>
      normalize(supportedLanguageName) === normalizedLanguageName,
  )?.id;
};

export const getLanguageKey = async (
  spokenLanguage: unknown,
): Promise<string | undefined> => {
  if (typeof spokenLanguage !== 'string' || !spokenLanguage.trim()) {
    return undefined;
  }

  const input = normalize(spokenLanguage);
  const languages = await loadLanguages();

  for (const { languageName } of languages) {
    const values = [languageName, ...(aliases[languageName] ?? [])];
    if (values.some((value) => normalize(value) === input)) {
      return languageName;
    }
  }

  // Speech recognition can return a short phrase around the language name.
  const match = languages.find(({ languageName }) => {
    const normalizedName = normalize(languageName);
    return input.includes(normalizedName) || normalizedName.includes(input);
  });

  return match?.languageName;
};
