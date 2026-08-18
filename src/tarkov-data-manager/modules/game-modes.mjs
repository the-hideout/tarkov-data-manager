const gameModes = [
    {
        name: 'regular',
        value: 0,
        skipData: [
            'seasonalPerks',
        ],
    },
    {
        name: 'pve',
        value: 1,
        skipData: [
            'achievements',
            'achievementStats',
            'customization',
            'seasonalPerks',
            'prestige',
        ],
    },
    {
        name: 'pvp-season',
        value: 2,
        skipData: [
            'achievements',
            'achievementStats',
            'customization',
            'prestige',
        ],
    },
];

export const getGameMode = (gameModeName) => {
    return gameModes.find(gm => gm.name === gameModeName);
};

export default gameModes;
