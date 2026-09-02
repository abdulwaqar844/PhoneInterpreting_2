import { eq } from 'drizzle-orm';
import { db } from '../../config/postgres';
import { Languages } from '../../models';

interface IArgs {
    languageCode: number,
}

export const languageExists = async ({ languageCode }: IArgs) => {
  const result = await db
    .select({ languageCode: Languages.language_code })
    .from(Languages)
    .where(eq(Languages.language_code, languageCode))
    .limit(1);

  return result.length > 0;
};
