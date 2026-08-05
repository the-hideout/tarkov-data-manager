const dogtags = {
    ids: {
        bear: '59f32bb586f774757e1e8442',
        usec: '59f32c3b86f77472a31742f0',
    },
} as const satisfies {
    readonly ids: Readonly<Record<'bear' | 'usec', string>>;
};

export default dogtags;
