export function normalizePhone(phone) {
  const cleaned = String(phone).replace(/\s+/g, '').replace(/^(\+84|84)/, '0');
  return cleaned;
}

export function isValidVietnamesePhone(phone) {
  return /^0\d{9,10}$/.test(normalizePhone(phone));
}

export function toSpeedSmsPhone(phone) {
  const normalized = normalizePhone(phone);
  return `84${normalized.slice(1)}`;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
