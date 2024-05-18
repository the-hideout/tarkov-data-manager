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
}

export const { dashToCamelCase, camelCaseToTitleCase } = stringFunctions;

export default stringFunctions;
