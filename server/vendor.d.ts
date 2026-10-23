declare module 'pdf-parse' {
  interface PdfResult { text: string; numpages: number; info: unknown; metadata: unknown; version: string }
  export default function parse(data: Buffer): Promise<PdfResult>;
}
