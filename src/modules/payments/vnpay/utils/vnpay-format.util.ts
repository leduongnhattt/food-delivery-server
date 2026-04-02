export function formatVnpCreateDateCompact(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
}

const VNP_ORDER_INFO_MAX_LENGTH = 255;

export function sanitizeVnpOrderDescription(raw: string): string {
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\-:.,/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, VNP_ORDER_INFO_MAX_LENGTH) || 'Payment for order';
}
