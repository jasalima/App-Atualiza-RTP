import { sql } from './db';
import { normalizeCpf } from './cpf';

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
export async function assertSignerIdentity(userId: string, input: string) {
  const cpf = normalizeCpf(input);
  if (!cpf) throw fail('CPF inválido. Confira os números.', 400);
  const [identity] = await sql`SELECT cpf FROM signer_identities WHERE auth_user_id=${userId}`;
  if (!identity) throw fail('Seu CPF ainda não foi confirmado pela administração. Peça o cadastro em Configurações > Editar acesso antes de assinar.', 409);
  if (identity.cpf !== cpf) throw fail('O CPF informado não corresponde ao CPF cadastrado para sua conta. Entre com a sua própria conta ou procure a administração.', 403);
  return cpf;
}
