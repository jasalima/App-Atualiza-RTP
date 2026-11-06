/**
 * Form 26 has two signature lines: the beneficiary (step 1) and the coordination's "De acordo" (step 2).
 * When the coordinator is the beneficiary, the request has a single signer and that one signature
 * fills both lines once the document is completed.
 */
export const isCoordination = (c: { role?: string | null; roleLabel?: string | null }) =>
  c.role === 'coordinator' || /coordena/i.test(c.roleLabel ?? '');

/** The signature printed on a Form 26 line, from the signatures collected so far. */
export function form26Signer<T extends { step: number }>(signed: T[], step: 1 | 2, completed: boolean): T | undefined {
  const own = signed.find((s) => s.step === step);
  if (own || step === 1) return own;
  return completed && signed.length === 1 && signed[0].step === 1 ? signed[0] : undefined;
}
