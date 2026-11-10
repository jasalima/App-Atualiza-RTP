// Número da OS da FAPTO que identifica a diária: "WEB:99999/2026". Shared by the server and the screens.
export const OS_PATTERN = /^WEB:\d{1,8}\/\d{4}$/;
export const OS_HINT = 'Formato WEB:99999/2026';
/** Accepts "web 99999/2026", "WEB: 99999 / 2026" or "99999/2026" and returns "WEB:99999/2026"; anything else is kept as typed. */
export function normalizeOs(value: string) {
  const m = value.trim().toUpperCase().match(/^(?:WEB\s*[:\-]?\s*)?(\d{1,8})\s*\/\s*(\d{4})$/);
  return m ? `WEB:${m[1]}/${m[2]}` : value.trim();
}
export const isValidOs = (value: string) => OS_PATTERN.test(value);
