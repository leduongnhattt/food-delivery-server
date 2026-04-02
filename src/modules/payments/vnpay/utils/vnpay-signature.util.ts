import { createHmac } from 'crypto';

export function sortVnpParameterKeysLexicographically(
  params: Record<string, string>,
): Record<string, string> {
  const sorted: Record<string, string> = {};
  Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      sorted[key] = params[key];
    });
  return sorted;
}

function encodePhpUrlEncodeStyle(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

export function buildVnpSignablePayloadString(sortedParams: Record<string, string>): string {
  return Object.entries(sortedParams)
    .map(([key, value]) => `${encodePhpUrlEncodeStyle(key)}=${encodePhpUrlEncodeStyle(value)}`)
    .join('&');
}

export function computeVnpHmacSha512Hex(secret: string, signablePayload: string): string {
  return createHmac('sha512', secret)
    .update(Buffer.from(signablePayload, 'utf-8'))
    .digest('hex');
}

export function collectVnpQueryFieldsForSignature(
  query: Record<string, string | undefined>,
): Record<string, string> {
  const forSigning: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    forSigning[key] = value;
  }
  return forSigning;
}
