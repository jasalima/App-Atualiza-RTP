import { randomInt } from 'node:crypto';

const lower = 'abcdefghijkmnopqrstuvwxyz';
const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const digits = '23456789';
const symbols = '!@#$%*-_';
const all = lower + upper + digits + symbols;

const pick = (characters: string) => characters[randomInt(characters.length)];

export function temporaryPassword(length = 18) {
  if (length < 12) throw new Error('A senha temporária precisa ter ao menos 12 caracteres.');
  const characters = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (characters.length < length) characters.push(pick(all));
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}

export function authFailure(error: { message?: string; status?: number; code?: string } | null) {
  if (!error) return null;
  if (error.status === 403) return Object.assign(new Error('O Neon Auth recusou a operação administrativa.'), { status: 502 });
  if (error.status === 409 || /already|exist/i.test(error.message ?? '')) return Object.assign(new Error('Já existe uma conta com este e-mail.'), { status: 409 });
  return Object.assign(new Error('Não foi possível concluir a operação no Neon Auth.'), { status: 502, cause: error });
}

export async function createAuthAccount(origin:string,input:{name:string;email:string;password:string}){
  const baseUrl=process.env.NEON_AUTH_BASE_URL;
  if(!baseUrl)throw new Error('NEON_AUTH_BASE_URL não configurada no ambiente de execução.');
  const response=await fetch(`${baseUrl.replace(/\/$/,'')}/sign-up/email`,{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify({...input,callbackURL:origin}),
    cache:'no-store',
  });
  const result=await response.json().catch(()=>({})) as {user?:{id?:string};message?:string;code?:string};
  if(response.status===409||/already|exist/i.test(result.message??''))throw Object.assign(new Error('Já existe uma conta com este e-mail.'),{status:409});
  if(!response.ok)throw Object.assign(new Error('Não foi possível criar a conta no Neon Auth.'),{status:502,cause:result.code});
  if(!result.user?.id)throw Object.assign(new Error('O Neon Auth não retornou o identificador da conta.'),{status:502});
  return result.user.id;
}
