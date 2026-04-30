export function normalisePhone(input, defaultCountryCode = '234') {
  if (!input || typeof input !== 'string') return '';
  let value = input.trim();
  value = value.replace(/^whatsapp:/i, '');
  value = value.replace(/[^\d+]/g, '');

  if (value.startsWith('+')) return value;
  if (value.startsWith('00')) return `+${value.slice(2)}`;
  if (value.startsWith('0')) return `+${defaultCountryCode}${value.slice(1)}`;
  if (value.startsWith(defaultCountryCode)) return `+${value}`;
  return `+${value}`;
}

export function isValidPhone(value) {
  const phone = normalisePhone(value);
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}
