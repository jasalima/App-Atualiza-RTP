import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Captures the real UI with fictitious data. Every API/network request is intercepted;
// this script cannot send WhatsApp messages or change a real account or document.
const base = process.env.MANUAL_BASE_URL || 'http://localhost:3100';
const directory = 'docs/manual/telas';
fs.mkdirSync(directory, { recursive: true });
const pid = '10000000-0000-4000-8000-000000000001', sid = '20000000-0000-4000-8000-000000000002', rid = '30000000-0000-4000-8000-000000000003';
const mid = '40000000-0000-4000-8000-000000000004', requestId = '50000000-0000-4000-8000-000000000005';
const stamp = '2026-11-05T12:00:00Z', hash = 'a'.repeat(64);
const project = { id: pid, title: 'Projeto Escola de Campo — exemplo', executing_institution: 'Instituição de pesquisa', support_foundation: 'FAPTO', coordinator: 'Coordenação de exemplo', city: 'Palmas – TO', starts_on: '2026-01-01', ends_on: '2026-12-31', status: 'active' };
const member = { id: sid, project_id: pid, full_name: 'Marina Exemplo', role_area: 'Pesquisadora', email: 'marina@example.invalid', phone: '5563999999999', starts_on: '2026-01-01', ends_on: '2026-12-31', status: 'active', work_plans: [], execution_records: [], reports: [] };
const content = { heading: { foundation: 'Fundação de Apoio Científico e Tecnológico do Tocantins', form: 'FORMULÁRIO 9', title: 'Relatório Técnico Parcial', project: project.title, scholar: member.full_name, scholarshipPeriod: '01/01/2026 a 31/12/2026', number: '01/2026' }, sections: { results: 'Foram realizadas visitas técnicas e organizado o levantamento de campo. Texto de exemplo para demonstrar a revisão pelo próprio membro.', comparison: 'A planilha de acompanhamento foi consolidada e revisada pela equipe. Confira os resultados antes de assinar.', additional: 'Dados fictícios usados apenas nas ilustrações do manual.' }, closing: { placeAndDate: 'Palmas – TO, 05 de novembro de 2026.', scholar: member.full_name, role: member.role_area }, pending: [] };
const person = { id: 'signer-demo', step: 1, name: member.full_name, roleLabel: member.role_area, status: 'pending', signedAt: null, cpf: null, rejectReason: null, cpfOnFile: '***.982.247-**' };
const signing = { request: { id: requestId, projectId: pid, kind: 'rtp', sourceId: rid, label: `RTP 01/2026 — ${member.full_name}`, status: 'pending', mode: 'sequential', signers: [person], link: `${base}/assinar/${requestId}`, createdAt: stamp }, projectTitle: project.title, documentHash: hash, document: { kind: 'rtp', number: '01/2026', version: 1, content }, me: person, manager: true, canEdit: true, canSign: true, identityReady: true };
const draft = { title: 'ATA DE REUNIÃO — EQUIPE DO PROJETO', subject: 'Planejamento das atividades de campo', meetingDate: '2026-11-05', startsAt: '09:00', endsAt: '10:00', modality: 'online', location: '', platform: 'Google Meet', chairedBy: 'Coordenação de exemplo', draftedBy: member.full_name, objective: 'Alinhar atividades e próximos prazos.', place: 'Palmas, TO', header: { lines: ['Instituição de pesquisa', project.title], address: 'Endereço institucional', footer: 'Ata de reunião' }, intro: null, topics: [{ id: 'topic-demo', title: 'Atividades e encaminhamentos', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A equipe definiu as próximas atividades. Conteúdo ilustrativo.' }] }] }, children: [] }], decisions: null, nextMeeting: { date: null, time: null, notes: '' }, closing: null, attachments: [], participants: [] };
const minute = { id: mid, projectId: pid, projectTitle: project.title, number: 'ATA Nº 001/2026', status: 'editing', displayStatus: 'editing', canEdit: true, manager: true, createdAt: stamp, updatedAt: stamp, draft, version: null, request: null };
const document = { id: '60000000-0000-4000-8000-000000000006', projectId: pid, scholarId: sid, scholarName: member.full_name, title: 'Termo de participação — exemplo', originalName: 'termo-exemplo.pdf', category: 'contract', kind: 'project_document', description: 'Documento fictício', mimeType: 'application/pdf', size: 204800, sha256: hash, version: 1, versions: 1, validUntil: null, createdBy: 'demo-user', createdAt: stamp, updatedAt: stamp };
const browser = await chromium.launch({ headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 980 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const state = { verified: false, signed: false, connected: false, saves: 0, documentHashSent: '' };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    const json = data => route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Cache-Control': 'no-store' } });
    if (p.includes('/api/auth/get-session')) return json({ session: { id: 'demo-session', token: 'demo-session', userId: 'demo-user', expiresAt: '2099-01-01T00:00:00Z', createdAt: stamp, updatedAt: stamp }, user: { id: 'demo-user', name: member.full_name, email: member.email, emailVerified: true, createdAt: stamp, updatedAt: stamp } });
    if (p === '/api/auth/token') return json({ token: 'demo.jwt.token' });
    if (p === '/api/users/me') return json({ id: 'demo-user', name: member.full_name, email: member.email, role: 'admin', projectId: pid, scholarId: sid, mustChangePassword: false });
    if (p === '/api/projects') return json([project]);
    if (p === '/api/notifications') return json([]);
    if (p === '/api/connectivity') {
      if (request.method() === 'POST') { const body = request.postDataJSON(); return json(body.action === 'connect' ? { connected: false, qr: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280"><rect width="280" height="280" fill="white"/><path d="M24 24h70v70H24zm162 0h70v70h-70zM24 186h70v70H24zM114 24h20v110h-20zm40 90h80v20h-80zm-40 40h20v100h-20zm40 0h20v60h-20zm40 0h60v20h-60zm0 40h20v60h-20zm40 0h20v60h-20z" fill="#173b43"/><text x="140" y="278" text-anchor="middle" font-size="11">QR ilustrativo — não conecta aparelho</text></svg>').toString('base64')}` } : {}); }
      return json({ configured: state.connected, state: state.connected ? 'open' : 'close', provisionAvailable: true, instance: 'Conexão de demonstração', code: 'READY' });
    }
    if (p === '/api/documents') return json([document]);
    if (p.includes('/api/documents/history') || p.includes('/api/documents/deliveries') || p === '/api/travel/reports') return json([]);
    if (p === `/api/signatures/${requestId}/document`) { assert.equal(request.method(), 'PUT'); content.sections = request.postDataJSON().sections; signing.document.version++; state.saves++; return json({ version: signing.document.version, content }); }
    if (p === `/api/signatures/${requestId}/sign`) { state.documentHashSent = request.postDataJSON().documentHash; return json({ completed: true, verificationCode: 'DEMO-DEMO-DEMO', signatureHash: hash }); }
    if (p === `/api/signatures/${requestId}`) return json(signing);
    if (p === '/api/signatures') return json([]);
    if (p === '/api/minutes/participants') return json([{ scholarId: sid, authUserId: 'demo-user', name: member.full_name, role: member.role_area, email: member.email, institution: 'Instituição de pesquisa', registration: 'Ativo', pendingFirstAccess: false }]);
    if (p === `/api/minutes/${mid}`) { if (request.method() === 'PUT') return json({ savedAt: stamp }); return json(minute); }
    if (p.includes('/api/external-signatures/')) {
      if (request.method() === 'POST') { const { action } = request.postDataJSON(); if (action === 'verify') state.verified = true; if (action === 'sign') state.signed = true; return json({ sent: true, verified: state.verified, signed: state.signed }); }
      if (url.searchParams.has('file')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n% Documento ilustrativo' });
      return json({ name: 'Convidado Exemplo', label: 'ATA Nº 001/2026 — Reunião de exemplo', phone: '•••• 8888', verified: state.verified, signed: state.signed, expiresAt: '2099-01-01' });
    }
    if (p.endsWith('/scholars')) return json([member]);
    if (['/reports', '/work_plans', '/execution_records'].some(path => p.endsWith(path))) return json([]);
    if (p.startsWith('/api/')) return json([]);
    if (url.origin === new URL(base).origin) return route.continue();
    return route.abort();
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const capture = async (name, target) => { await target.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' }); console.log(`Tela: ${name}`); };
  await page.goto(`${base}/connectivity`);
  await page.getByRole('button', { name: 'Conectar meu WhatsApp', exact: true }).click({ timeout: 90000 });
  await page.getByAltText('QR Code para conectar o WhatsApp da sua conta ao projeto atual').waitFor();
  await capture('whatsapp', page.locator('.connectivity-grid'));
  state.connected = true;
  await page.goto(`${base}/documents`);
  await page.getByText(document.title, { exact: true }).waitFor({ timeout: 60000 });
  await capture('documentos', page.locator('.page'));
  await page.getByRole('button', { name: `Enviar documento: ${document.title}` }).click();
  await page.getByLabel('Telefone do destinatário (DDI + DDD)').fill('5563999999999');
  await capture('enviar-documento', page.getByRole('dialog').locator('.drawer-body > .stack'));
  await page.goto(`${base}/assinar/${requestId}`);
  await page.getByRole('button', { name: 'Revisar e editar RTP' }).click({ timeout: 60000 });
  await page.getByLabel('1.1 Objetivos propostos versus alcançados').fill('Texto revisado pelo próprio membro. Conteúdo fictício para demonstrar a assinatura do RTP.');
  await capture('revisar-rtp', page.locator('.page'));
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar e editar RTP' }).waitFor();
  assert.equal(state.saves, 1);
  await page.locator('#assinar input[inputmode="numeric"]').fill('529.982.247-25');
  await page.locator('#assinar input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Assinar documento', exact: true }).click();
  await page.getByText('Assinatura registrada', { exact: true }).waitFor();
  assert.equal(state.documentHashSent, hash);
  await page.goto(`${base}/atas/${mid}`);
  await page.getByRole('button', { name: 'Adicionar convidado externo' }).click({ timeout: 60000 });
  await page.getByLabel('Nome completo', { exact: true }).fill('Convidado Exemplo');
  await page.getByRole('dialog').getByLabel('Instituição', { exact: true }).fill('Instituição convidada');
  await page.getByRole('dialog').getByLabel('Cargo ou função', { exact: true }).fill('Especialista convidado');
  await page.getByRole('dialog').getByLabel('E-mail', { exact: true }).fill('convidado@example.invalid');
  await page.getByRole('dialog').getByLabel('CPF do convidado').fill('390.533.447-05');
  await page.getByRole('dialog').getByLabel('WhatsApp do convidado (DDI + DDD)').fill('5511999988888');
  await capture('convidado-externo', page.getByRole('dialog').locator('form'));
  await page.goto(`${base}/assinar-externo/${'a'.repeat(43)}`);
  await page.getByLabel('Seu CPF', { exact: true }).fill('390.533.447-05');
  await page.getByRole('button', { name: 'Receber código pelo WhatsApp' }).click();
  await page.getByLabel('Código recebido no WhatsApp').fill('123456');
  await capture('confirmar-convidado', page.locator('.external-sign-content form'));
  await page.getByRole('button', { name: 'Confirmar código e abrir ata' }).click();
  await page.getByText('Identidade confirmada', { exact: true }).waitFor();
  assert.equal(state.verified, true);
  await page.getByLabel('Confirme seu CPF').fill('390.533.447-05');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Assinar ata', exact: true }).click();
  await page.getByText('Assinatura registrada', { exact: true }).waitFor();
  assert.equal(state.signed, true);
  await page.goto(`${base}/ajuda`);
  await capture('manual-online', page.locator('.manual-page'));
  assert.equal(await page.getByRole('link', { name: 'Baixar manual em PDF' }).getAttribute('href'), '/manual/Manual-do-Usuario-RTP-Inteligente.pdf');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'A ajuda não pode rolar horizontalmente no celular.');
  assert.deepEqual(errors, [], 'Erros no navegador');
  console.log('Fluxos de interface e layout móvel: OK (todas as APIs simuladas).');
  fs.rmSync(`${directory}/_debug.png`, { force: true });
} catch (error) {
  if (page) { console.error((await page.locator('body').innerText()).slice(0, 6000)); await page.screenshot({ path: `${directory}/_debug.png` }); }
  throw error;
} finally { await browser.close(); }
