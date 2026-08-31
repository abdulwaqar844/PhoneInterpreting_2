import { languageCodes } from '../../const/language/languageCodes';

interface IArgs {
    languageCode: number,
}

export const getLanguage = ({ languageCode }: IArgs) => languageCodes[languageCode];
