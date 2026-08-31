import { languageCodes } from '../../const/language/languageCodes';

interface IArgs {
    languageCode: number,
}

export const languageExists = ({ languageCode }: IArgs) => languageCodes[languageCode] !== undefined;
