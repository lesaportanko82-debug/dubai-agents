/**
 * Family-chat redaction before text reaches the model.
 *
 * OWED's redactor strips postal addresses, which is right for warranty claims and wrong for a
 * household agent that is asked to deliver groceries home. Here only machine-readable secrets are
 * removed — e-mails, card numbers, long phone numbers — and every pattern is word-bounded, so
 * "мёд." is never mistaken for "д." (house number).
 */
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],
  [/(?<![\d:])\+?\d{1,3}[\s\-()]*\d{2,4}[\s\-()]*\d{2,3}[\s\-]*\d{2}[\s\-]*\d{2,3}(?![\d:])/g, '[phone]'],
];

export function redact(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const [re, label] of PATTERNS) out = out.replace(re, () => { removed++; return label; });
  return { text: out, removed };
}
