import { eq } from 'drizzle-orm';
import { db } from '../../config/postgres';
import { Languages } from '../../models';

interface IArgs {
    languageCode: number,
}

export const getLanguage = async ({ languageCode }: IArgs) => {
  const result = await db
    .select({ languageName: Languages.language_name })
    .from(Languages)
    .where(eq(Languages.language_code, languageCode))
    .limit(1);

  return result[0]?.languageName;
};
