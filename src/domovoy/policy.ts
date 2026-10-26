/**
 * Household-level safety thresholds. No imports here on purpose: used by prompts, approvals, stores and tests.
 *
 * Money is multi-currency: each household picks its own currency and threshold (defaults come from the
 * timezone), and any amount a person mentions in another currency is converted before the check.
 */

export type Currency = 'AED' | 'USD' | 'EUR' | 'GBP' | 'SAR' | 'RUB' | 'KZT' | 'TRY' | 'INR' | 'PHP' | 'UZS' | 'BYN';

export const CURRENCIES: Currency[] = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'RUB', 'KZT', 'TRY', 'INR', 'PHP', 'UZS', 'BYN'];

/**
 * Approximate rates: 1 unit of the currency in AED. Used only to decide whether a sum crosses the
 * household threshold, never to pay anyone, so a few percent of drift is harmless. Update occasionally.
 */
export const AED_PER_UNIT: Record<Currency, number> = {
  AED: 1,
  USD: 3.67,
  EUR: 3.98,
  GBP: 4.65,
  SAR: 0.98,
  RUB: 0.045,
  KZT: 0.0068,
  TRY: 0.088,
  INR: 0.041,
  PHP: 0.063,
  UZS: 0.00029,
  BYN: 1.12,
};

/** Default threshold per currency ≈ 200 AED, rounded to a sum people actually say. */
export const DEFAULT_THRESHOLD: Record<Currency, number> = {
  AED: 200, USD: 50, EUR: 50, GBP: 40, SAR: 200, RUB: 5000, KZT: 30000, TRY: 2500, INR: 5000, PHP: 3000, UZS: 700000, BYN: 180,
};

/** Legacy default (Dubai household). Prefer store.currency / store.moneyThreshold. */
export const MONEY_THRESHOLD = { amount: 200, currency: 'AED' as Currency };

const TZ_CURRENCY: [RegExp, Currency][] = [
  [/^Asia\/(Dubai|Muscat)/, 'AED'], [/^Asia\/(Riyadh|Qatar|Bahrain|Kuwait)/, 'SAR'],
  [/^Asia\/(Almaty|Qyzylorda|Aqtobe|Aqtau|Atyrau|Oral)/, 'KZT'], [/^Asia\/Tashkent|^Asia\/Samarkand/, 'UZS'],
  [/^Europe\/(Moscow|Samara|Kaliningrad)|^Asia\/(Yekaterinburg|Novosibirsk|Krasnoyarsk|Irkutsk|Vladivostok)/, 'RUB'],
  [/^Europe\/Minsk/, 'BYN'], [/^Europe\/Istanbul/, 'TRY'], [/^Europe\/London/, 'GBP'], [/^Europe\//, 'EUR'],
  [/^Asia\/(Kolkata|Calcutta)/, 'INR'], [/^Asia\/Manila/, 'PHP'], [/^America\//, 'USD'],
];

/** Which currency a household most likely uses, from its timezone. */
export function defaultCurrency(tz: string): Currency {
  for (const [re, c] of TZ_CURRENCY) if (re.test(tz)) return c;
  return 'AED';
}

/** Normalise what people write: "дирхам", "$", "тенге", "руб" … → ISO code. Unknown → undefined. */
export function parseCurrency(raw?: string): Currency | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  const map: [RegExp, Currency][] = [
    [/^(aed|dh|dhs|дирхам|درهم)/, 'AED'], [/^(usd|\$|dollar|доллар)/, 'USD'], [/^(eur|€|euro|евро)/, 'EUR'], [/^(gbp|£|pound|фунт)/, 'GBP'],
    [/^(sar|riyal|риал|ريال)/, 'SAR'], [/^(rub|₽|руб|рубл)/, 'RUB'], [/^(kzt|₸|тенге|tenge)/, 'KZT'], [/^(try|₺|lira|лир)/, 'TRY'],
    [/^(inr|₹|rupee|рупи)/, 'INR'], [/^(php|₱|peso|песо)/, 'PHP'], [/^(uzs|сум|sum|so'm)/, 'UZS'], [/^(byn|бел\.? ?руб)/, 'BYN'],
  ];
  for (const [re, c] of map) if (re.test(s)) return c;
  const up = s.toUpperCase() as Currency;
  return CURRENCIES.includes(up) ? up : undefined;
}

export function convert(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  return (amount * AED_PER_UNIT[from]) / AED_PER_UNIT[to];
}

/** Does this sum need an admin? Converts into the household currency first. */
export function needsMoneyApproval(amount: number, currency: Currency, household: { currency: Currency; moneyThreshold: number }): { needs: boolean; inHousehold: number } {
  const inHousehold = convert(amount, currency, household.currency);
  return { needs: inHousehold > household.moneyThreshold, inHousehold: Math.round(inHousehold) };
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2)} ${currency}`;
}
