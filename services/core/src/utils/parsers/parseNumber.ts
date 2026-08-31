export const parseNumber = (str: string | undefined, def: number): number => {
    if (str === '') {
        return def;
    }

    const num = Number(str);

    if (num === 0 || Object.is(num, -0)) {
        return num;
    }

    return Number.isNaN(num) ? def : num;
};
