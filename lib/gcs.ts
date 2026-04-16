import { Storage } from '@google-cloud/storage';

const storage = new Storage({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  },
});

const bucket = storage.bucket(process.env.GCS_CEU_BUCKET_NAME!);

const SIGNED_URL_TTL_MS = process.env.GCS_SIGNED_URL_TTL_MS
  ? parseInt(process.env.GCS_SIGNED_URL_TTL_MS, 10)
  : 7 * 24 * 60 * 60 * 1000; // default 7 days

export async function uploadVerificationDoc(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<{ url: string; expiry: string; authenticatedUrl: string }> {
  const file = bucket.file(fileName);

  await file.save(buffer, { contentType: mimeType });

  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: expiresAt,
  });

  const authenticatedUrl = `https://storage.cloud.google.com/${process.env.GCS_CEU_BUCKET_NAME!}/${fileName}`;

  return { url, expiry: new Date(expiresAt).toISOString(), authenticatedUrl };
}
