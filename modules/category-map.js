const TRADERS = {
    prapor: {
        id: '54cb50c76803fa8b248b4571',
        name: 'Prapor',
        multiplier: 0.50, // Perfect
    },
    therapist: {
        id: '54cb57776803fa99248b456e',
        name: 'Therapist',
        multiplier: 0.63, // Perfect
    },
    fence: {
        id: '579dc571d53a0658a154fbec',
        name: 'Fence',
        multiplier: 0.40, // Perfect
    },
    skier: {
        id: '58330581ace78e27b8b10cee',
        name: 'Skier',
        multiplier: 0.49, // Perfect
    },
    peacekeeper: {
        id: '5935c25fb3acc3127c3d8cd9',
        name: 'Peacekeeper',
        multiplier: 0.50, // A little off
    },
    mechanic: {
        id: '5a7c2eca46aef81a7ca2145d',
        name: 'Mechanic',
        multiplier: 0.56, // Perfect
    },
    ragman: {
        id: '5ac3b934156ae10c4430e83c',
        name: 'Ragman',
        multiplier: 0.62, // Perfect
    },
    jaeger: {
        id: '5c0647fdd443bc2504c2d371',
        name: 'Jaeger',
        multiplier: 0.60, // Perfect
    },
};

module.exports = {
    traders: TRADERS,
    categories: {
        '5448ecbe4bdc2d60728b4568': {
            id: '5448ecbe4bdc2d60728b4568',
            name: 'Info',
            traders: [
                TRADERS.fence,
                TRADERS.peacekeeper,
            ],
        },
        '55818aeb4bdc2ddc698b456a': {
            id: '55818aeb4bdc2ddc698b456a',
            name: 'SpecialScope',
            traders: [
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5448e8d64bdc2dce718b4568': {
            name: 'Drinks',
            id: '5448e8d64bdc2dce718b4568',
            parentId: '543be6674bdc2df1348b4569',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5795f317245977243854e041': {
            name: 'SimpleContainer',
            id: '5795f317245977243854e041',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.ragman,
            ],
        },
        '5c164d2286f774194c5e69fa': {
            name: 'Keycard',
            id: '5c164d2286f774194c5e69fa',
            traders: [
                TRADERS.therapist,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5447e1d04bdc2dff2f8b4567': {
            name: 'Knife',
            id: '5447e1d04bdc2dff2f8b4567',
            traders: [
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '57864a3d24597754843f8721': {
            name: 'Jewelry',
            id: '57864a3d24597754843f8721',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
            ],
        },
        '5c99f98d86f7745c314214b3': {
            name: 'KeyMechanical',
            id: '5c99f98d86f7745c314214b3',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '57864a66245977548f04a81f': {
            name: 'Electronics',
            id: '57864a66245977548f04a81f',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '57864ada245977548638de91': {
            name: 'BuildingMaterial',
            id: '57864ada245977548638de91',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5448eb774bdc2d0a728b4567': {
            name: 'BarterItems',
            id: '5448eb774bdc2d0a728b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.skier,
            ],
        },
        '57bef4c42459772e8d35a53b': {
            name: 'ArmoredEquipment',
            id: '57bef4c42459772e8d35a53b',
            traders: [
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.ragman,
            ],
        },
        '5448f3a64bdc2d60728b456a': {
            name: 'Stimulator',
            id: '5448f3a64bdc2d60728b456a',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5448f3ac4bdc2dce718b4569': {
            name: 'Medical',
            id: '5448f3ac4bdc2dce718b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.ragman,
                TRADERS.jaeger,
            ],
        },
        '5448f3a14bdc2d27728b4569': {
            name: 'Drugs',
            id: '5448f3a14bdc2d27728b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5448f39d4bdc2d0a728b4568': {
            name: 'Medkit',
            id: '5448f39d4bdc2d0a728b4568',
            traders: [
                TRADERS.prapor,
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5448e8d04bdc2ddf718b4569': {
            name: 'Food',
            id: '5448e8d04bdc2ddf718b4569',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.jaeger,
            ],
        },
        '5671435f4bdc2d96058b4569': {
            name: 'LockableContainer',
            id: '5671435f4bdc2d96058b4569',
            traders: [
                TRADERS.therapist,
                TRADERS.fence,
                TRADERS.ragman,
            ],
        },
        '55818add4bdc2d5b648b456f': {
            name: 'AssualtScopes',
            id: '55818add4bdc2d5b648b456f',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '550aa4cd4bdc2dd8348b456c': {
            name: 'Silencer',
            id: '550aa4cd4bdc2dd8348b456c',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818ae44bdc2dde698b456c': {
            name: 'OpticScope',
            id: '55818ae44bdc2dde698b456c',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818ad54bdc2ddc698b4569': {
            name: 'Collimator',
            id: '55818ad54bdc2ddc698b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5448e53e4bdc2d60728b4567': {
            name: 'Backpack',
            id: '5448e53e4bdc2d60728b4567',
            traders: [
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.ragman,
                TRADERS.jaeger,
            ],
        },
        '5448e5284bdc2dcb718b4567': {
            name: 'Vest',
            id: '5448e5284bdc2dcb718b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.ragman,
                TRADERS.jaeger,
            ],
        },
        '55818acf4bdc2dde698b456b': {
            name: 'CompactCollimator',
            id: '55818acf4bdc2dde698b456b',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5645bcb74bdc2ded0b8b4578': {
            name: 'Headphones',
            id: '5645bcb74bdc2ded0b8b4578',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.ragman,
                TRADERS.jaeger,
            ],
        },
        '5447b5f14bdc2d61278b4567': {
            name: 'AssaultRifle',
            id: '5447b5f14bdc2d61278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
                TRADERS.jaeger,
            ],
        },
        '5447b5fc4bdc2d87278b4567': {
            name: 'AssaultCarbine',
            id: '5447b5fc4bdc2d87278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5447b6254bdc2dc3278b4568': {
            name: 'SniperRifle',
            id: '5447b6254bdc2dc3278b4568',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
                TRADERS.jaeger,
            ],
        },
        '5447bed64bdc2d97278b4568': {
            name: 'MachineGun',
            id: '5447bed64bdc2d97278b4568',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
                TRADERS.jaeger,
            ],
        },
        '5447b6194bdc2d67278b4567': {
            name: 'MarksmanRifle',
            id: '5447b6194bdc2d67278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
                TRADERS.jaeger,
            ],
        },
        '5447b5cf4bdc2d65278b4567': {
            name: 'Pistol',
            id: '5447b5cf4bdc2d65278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5447b6094bdc2dc3278b4567': {
            name: 'Shotgun',
            id: '5447b6094bdc2dc3278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
                TRADERS.jaeger,
            ],
        },
        '5447b5e04bdc2d62278b4567': {
            name: 'Smg',
            id: '5447b5e04bdc2d62278b4567',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '543be6564bdc2df4348b4568': {
            name: 'ThrowWeap',
            id: '543be6564bdc2df4348b4568',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
            ],
        },
        '5485a8684bdc2da71d8b4567': {
            name: 'Ammo',
            id: '5485a8684bdc2da71d8b4567',
            traders: [
                TRADERS.fence,
                TRADERS.prapor,
            ],
        },
        '5448bc234bdc2d3c308b4569': {
            name: 'Magazine',
            id: '5448bc234bdc2d3c308b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818b164bdc2ddc698b456c': {
            name: 'TacticalCombo',
            id: '55818b164bdc2ddc698b456c',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818b084bdc2d5b648b4571': {
            name: 'Flashlight',
            id: '55818b084bdc2d5b648b4571',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818af64bdc2d5b648b4570': {
            name: 'Foregrip',
            id: '55818af64bdc2d5b648b4570',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818a594bdc2db9688b456a': {
            name: 'Stock',
            id: '55818a594bdc2db9688b456a',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818a684bdc2ddd698b456d': {
            name: 'PistolGrip',
            id: '55818a684bdc2ddd698b456d',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818b224bdc2dde698b456f': {
            name: 'Mount',
            id: '55818b224bdc2dde698b456f',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818a304bdc2db5418b457d': {
            name: 'Receiver',
            id: '55818a304bdc2db5418b457d',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818a6f4bdc2db9688b456b': {
            name: 'Charge',
            id: '55818a6f4bdc2db9688b456b',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '56ea9461d2720b67698b456f': {
            name: 'Gasblock',
            id: '56ea9461d2720b67698b456f',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '550aa4bf4bdc2dd6348b456b': {
            name: 'FlashHider',
            id: '550aa4bf4bdc2dd6348b456b',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '550aa4dd4bdc2dc9348b4569': {
            name: 'MuzzleCombo',
            id: '550aa4dd4bdc2dc9348b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '5a74651486f7744e73386dd1': {
            name: 'AuxiliaryMod',
            id: '5a74651486f7744e73386dd1',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.mechanic,
            ],
        },
        '55818a104bdc2db9688b4569': {
            name: 'Handguard',
            id: '55818a104bdc2db9688b4569',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '555ef6e44bdc2de9068b457e': {
            name: 'Barrel',
            id: '555ef6e44bdc2de9068b457e',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818afb4bdc2dde698b456d': {
            name: 'Bipod',
            id: '55818afb4bdc2dde698b456d',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '55818ac54bdc2d5b648b456e': {
            name: 'IronSight',
            id: '55818ac54bdc2d5b648b456e',
            traders: [
                TRADERS.prapor,
                TRADERS.fence,
                TRADERS.skier,
                TRADERS.peacekeeper,
                TRADERS.mechanic,
            ],
        },
        '567849dd4bdc2d150f8b456e': {
            name: 'Map',
            id: '567849dd4bdc2d150f8b456e',
            traders: [],
        },
        '5b3f15d486f77432d0509248': { // checked
            name: 'ArmBand',
            id: '5b3f15d486f77432d0509248',
            traders: [
                TRADERS.ragman,
            ],
        },
        '5447e0e74bdc2d3c308b4567': {
            name: 'SpecItem',
            id: '5447e0e74bdc2d3c308b4567',
            traders: [],
        },
        '543be5cb4bdc2deb348b4568': {
            name: 'AmmoBox',
            id: '543be5cb4bdc2deb348b4568',
            traders: [
                TRADERS.fence,
            ],
        },
        '543be5dd4bdc2deb348b4569': {
            name: 'Money',
            id: '543be5dd4bdc2deb348b4569',
            traders: [],
        },
        '5448bf274bdc2dfc2f8b456a': {
            name: 'MobContainer',
            id: '5448bf274bdc2dfc2f8b456a',
            traders: [],
        },
        '5447bedf4bdc2d87278b4568': {
            name: 'GrenadeLauncher',
            id: '5447bedf4bdc2d87278b4568',
            traders: [],
        },
        '55818b014bdc2ddc698b456b': {
            name: 'Launcher',
            id: '55818b014bdc2ddc698b456b',
            traders: [],
        },
    },
}
