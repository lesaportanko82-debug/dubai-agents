/**
 * Strip personal data BEFORE text reaches the model or the database.
 * Customer names are removed by the model instruction; this layer removes the
 * machine-detectable identifiers so they never leave our process.
 */
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(?:\+?\d[\s\-()]?){9,15}\d/g, '[phone]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],
  [/(?:ул\.|улица|street|st\.|проспект|пр\.|д\.|кв\.)\s*[^\n,;]{1,40}/gi, '[address]'],
];

export function redact(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, () => {
      removed++;
      return label;
    });
  }
  return { text: out, removed };
}
