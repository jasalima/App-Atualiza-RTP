// RTP numbering: one sequence per project and year, shared by all scholars.
// "01/2026" is followed by "02/2026" whoever the next report belongs to.

export const rtpYear = (issuedOn: string) => issuedOn.slice(0, 4);

/** Next number for `year` given every number already used in the project (deleted reports included). */
export function nextRtpNumber(used: string[], year: string) {
  const last = used.reduce((max, n) => {
    const m = /^(\d+)\/(\d{4})$/.exec(n.trim());
    return m && m[2] === year ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${String(last + 1).padStart(2, '0')}/${year}`;
}
