function normalizePhoneNumber(raw, defaultCountryCode = '60') {
    const value = String(raw || '').trim();
    if (!value) return '';

    let digits = value.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    digits = digits.replace(/\D/g, '');

    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);

    if (digits.startsWith('60') || digits.startsWith('65')) return digits;

    if (defaultCountryCode === '60') {
        if (digits.startsWith('0')) return '60' + digits.slice(1);
        if (/^1\d{7,9}$/.test(digits)) return '60' + digits;
    }

    if (defaultCountryCode === '65' && /^[3689]\d{7}$/.test(digits)) {
        return '65' + digits;
    }

    return digits;
}

function parsePhoneNumbers(input, defaultCountryCode = '60') {
    const seen = new Set();
    return String(input || '')
        .split(/[\r\n,;\uFF0C\uFF1B\u3001]+/)
        .map(part => normalizePhoneNumber(part, defaultCountryCode))
        .filter(number => {
            if (!number || seen.has(number)) return false;
            seen.add(number);
            return true;
        });
}

module.exports = { normalizePhoneNumber, parsePhoneNumbers };
