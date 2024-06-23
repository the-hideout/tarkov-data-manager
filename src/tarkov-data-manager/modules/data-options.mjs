const dataOptions = {
    default: {
        download: false,
        gameMode: 'regular',
    },
    merge: (options = {}, defaults = {}) => {
        if (typeof options === 'boolean') {
            options = { download: options };
        }
        return {
            ...dataOptions.default,
            ...defaults,
            ...options,
        };
    },
};

export default dataOptions;
