// The strings that look the same probably has a russian A instead of a real one
const REPLACEMENTS = {
    'MRE': 'MRE lunch box',
    'Frameless': 'Red Rebel Ice pick',
    'Team Wendy EXFIL Ballistic Helmet': 'Team Wendy EXFIL Ballistic Helmet Black',
    'Immobilizing splint (alu)': 'Immobilizing splint',
    'AK-74 5.45x39 assault rifle': 'АK-74 5.45x39 assault rifle',
    '60-round 6L31 5.45x39 magazine for AK-74 and compatibles': '60-round 6L31 5.45x39 magazine for АК-74 and compatibles',
    '6L18 45-round 5.45x39 magazine for AK-74 and compatible weapons': '6L18 45-round 5.45x39 magazine for АК-74 and compatible weapons',
    'Object 11SR keycard': 'Object #11SR keycard',
    'Object 21WS keycard': 'Object #21WS keycard',
    'Lab. Yellow keycard': 'TerraGroup Labs keycard (Yellow)',
    '30-round 6L23 5.45x39 magazine for AK-74 and compatibles': '30-round 6L23 5.45x39 magazine for АК-74 and compatibles',
    'Izhmash wooden AK-74 stock (6P20 Sb.5)': 'Izhmash wooden АК-74 stock (6P20 Sb.5)',
    'Izhmash 7.62x39 AKM muzzle brake & compensator (6P1 0-14)': 'Izhmash 7.62x39 АКM muzzle brake & compensator (6P1 0-14)',
    '9x18 PM mm RG028 gzh': '9x18mm PM RG028 gzh',
    '5.56x45 mm Warmage': '5.56x45mm Warmage',
    'Lab. Yellow keycard.': 'TerraGroup Labs keycard (Yellow)',
    'Lucky Scav Junkbox': 'Lucky Scav Junk box',
    'Special Sniper Rifle VSS Vintorez': 'VSS Vintorez 9x39 Special Sniper Rifle',
    'Simonov Semi-Automatic Carbine SKS 7.62x39 Hunting Rifle Version': 'Simonov OP-SKS 7.62x39 semi-automatic carbine (Hunting Rifle Version)',
    'Kiba Arms International SPRM mount for pump-action shotguns': 'Kiba Arms International SPRM rail mount for pump-action shotguns',
    'Sig-Sauer SRD QD 7.62x51 Sound Suppressor': 'SIG Sauer SRD762-QD 7.62x51 sound suppressor',
    'Immobilizing splint (alu)': 'Aluminum splint',
    'Maska-1Shch bulletproof helmet': 'Maska-1SCh bulletproof helmet (Olive Drab)',
    'Maska-1Shch face shield': 'Maska-1SCh face shield (Olive Drab)',
    'HighCom Trooper TFO armor (Multicam)': 'HighCom Trooper TFO body armor (Multicam)',
    'Purified water canister': 'Canister with purified water',
    '0.6 liter water bottle': 'Bottle of water (0.6L)',
    'LOBAEV Arms DVL-10 Saboteur 7.62x51 bolt-action sniper rifle': 'Lobaev Arms DVL-10 7.62x51 bolt-action sniper rifle',
    'Mosin Rifle 730mm regular barrel': 'Mosin Rifle 7.62x54R 730mm regular barrel',
    'VPO-101 "Vepr-Hunter" 7.62x51 carbine': 'Molot VPO-101 "Vepr-Hunter" 7.62x51 carbine'
};

const PARTIAL_REPLACEMENTS = {
    'Yellow keycard': 'TerraGroup Labs keycard (Yellow)',
};

module.exports = (name) => {
    if(!name){
        return name;
    }

    if(REPLACEMENTS[name]){
        return REPLACEMENTS[name];
    }

    for(const partialReplacement in PARTIAL_REPLACEMENTS){
        if(name.includes(partialReplacement)){
            return PARTIAL_REPLACEMENTS[partialReplacement];
        }
    }

    return name;
};