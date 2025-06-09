export const safeParseInt = (str: string): number => {
    return parseInt(str, 10);
};

// Usage example:
// const dpidNumbers = dpids.map(safeParseInt);
