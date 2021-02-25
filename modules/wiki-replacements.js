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
    'Lab. Yellow keycard': 'Lab. Yellow keycard.',
    '30-round 6L23 5.45x39 magazine for AK-74 and compatibles': '30-round 6L23 5.45x39 magazine for АК-74 and compatibles',
    'Izhmash wooden AK-74 stock (6P20 Sb.5)': 'Izhmash wooden АК-74 stock (6P20 Sb.5)',
    'Izhmash 7.62x39 AKM muzzle brake & compensator (6P1 0-14)': 'Izhmash 7.62x39 АКM muzzle brake & compensator (6P1 0-14)',
    '9x18 PM mm RG028 gzh': '9x18mm PM RG028 gzh',
    '5.56x45 mm Warmage': '5.56x45mm Warmage',
};

module.exports = (name) => {
    return REPLACEMENTS[name] || name;
};