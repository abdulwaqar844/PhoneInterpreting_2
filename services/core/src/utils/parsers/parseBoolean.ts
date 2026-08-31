export const parseBoolean = (str: string | undefined, def: boolean): boolean => {
    if (!str || str?.length === 0) {
        return def;
    }
    const preparedStr = str.trim().toLowerCase();
    return ['true', '1'].includes(preparedStr);
};
