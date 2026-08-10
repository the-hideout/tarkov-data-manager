const stringFunctions = {
    dashToCamelCase: input => {
        return input.toLowerCase().replace(/-(.)/g, function(match, group1) {
            return group1.toUpperCase();
        });
    },
    camelCaseToTitleCase: input => {
        return input.replace(/([A-Z])/g, (match) => ` ${match}`)
            .replace(/^./, (match) => match.toUpperCase())
            .trim();
    },
    camelCaseToSnakeCase: input => {
        return input.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    },
}

export const { dashToCamelCase, camelCaseToTitleCase, camelCaseToSnakeCase } = stringFunctions;

export default stringFunctions;
