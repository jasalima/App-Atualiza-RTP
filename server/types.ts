export type Role = 'admin' | 'coordinator' | 'scholar';
export interface Session { sub: string; role: Role; projectId: string | null; scholarId?: string | null }
export interface ReportContent {
  heading: { foundation: string; form: string; title: string; project: string; scholar: string; scholarshipPeriod: string; number: string };
  sections: { results: string; comparison: string; additional: string };
  closing: { placeAndDate: string; scholar: string; role: string };
  pending: Array<{ activity: string; reason: string }>;
}
