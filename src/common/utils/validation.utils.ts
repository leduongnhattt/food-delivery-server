export function isCountryCode2(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

export function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isStripeAccountId(value: string): boolean {
  return /^acct_[A-Za-z0-9]+$/.test(value);
}

export function isHolderNameLike(value: string): boolean {
  // Allow internationalized names (Vietnamese accents) but keep strict on punctuation.
  return /^[\p{L}\s.'-]+$/u.test(value);
}

