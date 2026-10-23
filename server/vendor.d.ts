declare module 'pdf-parse' {
  interface PdfResult { text: string; numpages: number; info: unknown; metadata: unknown; version: string }
  // pagerender receives a pdf.js page; its text items carry positions in `transform`.
  interface PdfOptions { pagerender?: (page: any) => Promise<string> }
  export default function parse(data: Buffer, options?: PdfOptions): Promise<PdfResult>;
}
