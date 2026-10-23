import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
export function signedDownloadUrl(key:string){
  return getSignedUrl(storage,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:300});
}
export function putPrivateObject(key:string,body:Buffer,contentType:string){
  return storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType}));
}
