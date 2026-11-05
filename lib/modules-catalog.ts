// Modules of the application. Each profile includes some of them; the administration can
// enable the "grantable" ones for any account of a project (e.g. Atas de Reunião for a member
// with a signature-only account).
export type ModuleKey = 'projects' | 'scholars' | 'plans' | 'executions' | 'reports' | 'travel' | 'documents' | 'signatures' | 'minutes' | 'whatsapp' | 'minutes_sender';
export const MODULES: Record<ModuleKey, { label: string; grantable: boolean; description?: string; requires?: ModuleKey[] }> = {
  projects: { label: 'Projetos', grantable: false }, scholars: { label: 'Bolsistas', grantable: false }, plans: { label: 'Planos de Trabalho', grantable: false },
  executions: { label: 'Execução das atividades', grantable: false }, reports: { label: 'Relatórios (RTP)', grantable: false }, travel: { label: 'Diárias e passagens', grantable: false },
  documents: { label: 'Documentos', grantable: false }, signatures: { label: 'Assinaturas', grantable: false },
  minutes: { label: 'Atas de Reunião', grantable: true, description: 'Criar, editar e encaminhar atas para assinatura; ver as atas do projeto.' },
  whatsapp: { label: 'Conexão WhatsApp', grantable: true, description: 'Conectar o próprio número pelo QR Code em Conectividade, para que os envios saiam dele.' },
  minutes_sender: { label: 'Envio das atas pelo WhatsApp', grantable: true, requires: ['minutes', 'whatsapp'], description: 'O número desta pessoa envia as atas aos participantes: pedidos de assinatura e a ata concluída. Um responsável por projeto.' }
};
export const GRANTABLE = (Object.keys(MODULES) as ModuleKey[]).filter((k) => MODULES[k].grantable);
/** What each profile includes without any grant. */
export const PROFILE_MODULES: Record<string, ModuleKey[]> = {
  admin: ['projects', 'scholars', 'plans', 'executions', 'reports', 'travel', 'documents', 'signatures', 'minutes', 'whatsapp'],
  coordinator: ['projects', 'scholars', 'plans', 'executions', 'reports', 'travel', 'documents', 'signatures', 'minutes', 'whatsapp'],
  scholar: ['executions', 'reports', 'travel', 'documents', 'signatures', 'whatsapp'],
  signer: ['signatures']
};
