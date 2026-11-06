// Legal basis printed on every electronically signed document and shown on the signing and
// verification pages. It describes what the platform's signature is (an electronic signature
// with evidence of authorship and integrity), without claiming an ICP-Brasil certificate.
export const LEGAL_TITLE = 'FUNDAMENTAÇÃO LEGAL DAS ASSINATURAS ELETRÔNICAS';
export const LEGAL_BASIS = 'As assinaturas deste documento são assinaturas eletrônicas, admitidas como meio de comprovação de autoria e integridade de documentos eletrônicos nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, e reguladas pelo art. 4º da Lei nº 14.063/2020, observada a liberdade de forma das declarações de vontade (art. 107 do Código Civil).';
export const LEGAL_EVIDENCE = 'Cada assinatura vincula o signatário, identificado por conta pessoal de acesso e CPF, ao resumo criptográfico SHA-256 do conteúdo, com registro de data, hora (horário oficial de Brasília) e endereço IP. Qualquer alteração posterior do conteúdo é detectada na verificação pública do documento.';
export const LEGAL_SHORT = 'Assinatura eletrônica — art. 10, § 2º, da MP nº 2.200-2/2001 e art. 4º da Lei nº 14.063/2020.';

/*
 * Declaration of will shown before every signature. Each text has a version: the version
 * accepted, and the SHA-256 of its exact text, are recorded in the evidence of the signature.
 * A text is never edited in place — a new wording gets a new version, so the evidence of an
 * earlier signature keeps pointing to the words that person actually accepted.
 */
export const CONSENT_TEXTS = {
  // Current declaration (procedure RTP-ASSINATURA-2, from November 2026).
  'DECL-2026-11': 'Declaro que li e estou ciente do conteúdo integral deste documento, manifestando expressamente minha concordância com sua assinatura por meio eletrônico. Reconheço que esta operação ficará vinculada à minha identificação pessoal e aos respectivos registros eletrônicos de autenticação, integridade e auditoria, observadas as disposições legais aplicáveis.',
  // Wordings shown before it; accepted only from a page still open with the earlier screen.
  'DECL-2026-10-CONTA': 'Li o documento e declaro que as informações são verdadeiras. Concordo em assiná-lo eletronicamente, ficando registrados meu nome, CPF, data, hora e endereço IP.',
  'DECL-2026-10-EXTERNO': 'Li a ata, confirmo minha identidade e concordo em assinar eletronicamente. Serão registrados meu nome, CPF, data, hora, IP e a integridade do documento.'
} as const;
export type ConsentVersion = keyof typeof CONSENT_TEXTS;
export const CONSENT_VERSION: ConsentVersion = 'DECL-2026-11';
export const CONSENT_TEXT = CONSENT_TEXTS[CONSENT_VERSION];
export const isConsentVersion = (v: unknown): v is ConsentVersion => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CONSENT_TEXTS, v);
