#!/usr/bin/env node
// Independent check of an evidence bundle exported by the RTP platform (Coordenação >
// documento > "Exportar evidências"). Needs only Node.js 18+; no access to the platform.
//
//   node scripts/verificar-evidencias.mjs evidencias-xxxxxxxx.json [chave-publica.pem]
//
// For every record it recomputes SHA-256 of the payload, the chain link and the Ed25519
// signature. Pass the public key obtained independently (e.g. printed in the dossier or
// downloaded from /api/public/evidence-key) to avoid trusting the key inside the bundle.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [file, pemFile] = process.argv.slice(2);
if (!file) { console.error('Uso: node scripts/verificar-evidencias.mjs <pacote.json> [chave-publica.pem]'); process.exit(2); }
const bundle = JSON.parse(readFileSync(file, 'utf8'));
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const external = pemFile ? readFileSync(pemFile, 'utf8') : null;
const keyOf = (id) => external ?? bundle.keys.find((k) => k.keyId === id)?.publicKey;
let failures = 0;
for (const e of bundle.evidence) {
  const hashOk = sha(e.payload) === e.payload_hash;
  const linkOk = Number(e.seq) === 1 ? e.prev_hash === bundle.genesis : e.previous_chain_hash === e.prev_hash;
  const chainOk = linkOk && sha(`${e.prev_hash}|${e.payload_hash}`) === e.chain_hash;
  let sig = 'ausente';
  if (e.server_signature) {
    const pem = keyOf(e.key_id);
    sig = pem && verify(null, Buffer.from(e.payload, 'utf8'), createPublicKey(pem), Buffer.from(e.server_signature, 'base64')) ? 'válida' : 'INVÁLIDA';
  }
  const ok = hashOk && chainOk && sig !== 'INVÁLIDA';
  if (!ok) failures++;
  console.log(`#${e.seq} ${e.event.padEnd(18)} hash:${hashOk ? 'ok' : 'FALHA'}  encadeamento:${chainOk ? 'ok' : 'FALHA'}  assinatura do servidor:${sig}${e.key_id ? ` (chave ${e.key_id})` : ''}`);
}
console.log(failures ? `\n${failures} registro(s) NÃO conferem.` : `\nTodos os ${bundle.evidence.length} registros conferem.`);
process.exit(failures ? 1 : 0);
