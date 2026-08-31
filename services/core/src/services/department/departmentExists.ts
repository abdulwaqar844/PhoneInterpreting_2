import { departmentCodes } from '../../const/department/departmentCodes';

interface IArgs {
    departmentCode: number,
}

export const departmentExists = ({ departmentCode }: IArgs) => departmentCodes[departmentCode] !== undefined;
export const getDepartmentName = ({ departmentCode }: IArgs) => {
    if (!departmentExists({ departmentCode })) {
        throw new Error(`Department code ${departmentCode} does not exist`);
    }
    return departmentCodes[departmentCode];
}