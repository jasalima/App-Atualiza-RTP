/** Brazilian CPF, including both check digits; returned without formatting. */
export function normalizeCpf(value: string) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const check = (len: number) => { let sum = 0; for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]) ? d : null;
}
