const dogtags = {
    ids: {
        bear: '59f32bb586f774757e1e8442',
        usec: '59f32c3b86f77472a31742f0',
        any: 'customdogtags12345678910',
    },
    isDogtag: (id) => {
        return Object.values(dogtags.ids).includes(id);
    },
};

export default dogtags;