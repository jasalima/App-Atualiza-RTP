import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const bucket = process.env.NEON_STORAGE_BUCKET ?? 'rtp-private';
const storage = new S3Client({
  region: process.env.AWS_REGION ?? 'auto',
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

export function signedUploadUrl(key:string,contentType:string){
  return getSignedUrl(storage,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType}),{expiresIn:300});
}
export function signedDownloadUrl(key:string,options:{filename?:string;inline?:boolean;contentType?:string}={}){
  // The browser receives the original name; inline lets PDFs and images open in a tab.
  const disposition=options.filename?`${options.inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(options.filename)}`:undefined;
  return getSignedUrl(storage,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:disposition,ResponseContentType:options.inline?options.contentType:undefined}),{expiresIn:300});
}
/** Size of a stored object, or null when it does not exist. */
export async function headPrivateObject(key:string){
  try{const r=await storage.send(new HeadObjectCommand({Bucket:bucket,Key:key}));return {size:Number(r.ContentLength??0),contentType:r.ContentType??''};}
  catch(error){if((error as {name?:string}).name==='NotFound'||(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw error;}
}
export function putPrivateObject(key:string,body:Buffer,contentType:string){
  return storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType}));
}

export async function readPrivateObject(key: string, maxBytes: number) {
  const result = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error('Arquivo não encontrado no armazenamento.');
  if (result.ContentLength && result.ContentLength > maxBytes) { await result.Body.transformToWebStream().cancel(); throw Object.assign(new Error('O documento excede o limite de 20 MB para envio.'), { status: 413 }); }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('O documento excede o limite de 20 MB para envio.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
