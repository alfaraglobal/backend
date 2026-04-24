export function normalizePhone(raw: string): string | null {
  if (raw.length > 25) return null;
  const normalized = raw.replace(/\s/g, '');
  const digits = normalized.replace(/\D/g, '');
  if (normalized.length > 20 || !/^[+\d\-().]+$/.test(normalized) || digits.length < 7 || digits.length > 15)
    return null;
  return normalized;
}
