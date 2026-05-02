import { Storage } from '@google-cloud/storage';
import type { Lang } from './config';

const storage = new Storage({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  },
});

const ceuBucket = storage.bucket(process.env.GCS_CEU_BUCKET_NAME!);
const newsletterBucket = storage.bucket(process.env.GCS_NEWSLETTER_BUCKET_NAME!);

const SIGNED_URL_TTL_MS = process.env.GCS_CEU_SIGNED_URL_TTL_MS
  ? parseInt(process.env.GCS_CEU_SIGNED_URL_TTL_MS, 10)
  : 7 * 24 * 60 * 60 * 1000; // default 7 days

const NEWSLETTER_UPLOAD_TTL_MS = 15 * 60 * 1000; // 15 minutes
const NEWSLETTER_DOWNLOAD_TTL_MS = 5 * 60 * 1000; // 5 minutes

function newsletterFilePath(newsletterId: string, lang: Lang): string {
  const id = newsletterId.replace(/-/g, '');
  return `${newsletterId}/ag_newsletter_${id}_${lang}.pdf`;
}

export async function uploadVerificationDoc(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<{ url: string; expiry: string; authenticatedUrl: string }> {
  const file = ceuBucket.file(fileName);

  await file.save(buffer, { contentType: mimeType });

  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: expiresAt,
  });

  const authenticatedUrl = `https://storage.cloud.google.com/${process.env.GCS_CEU_BUCKET_NAME!}/${fileName}`;

  return { url, expiry: new Date(expiresAt).toISOString(), authenticatedUrl };
}

export async function getNewsletterSignedUploadUrl(newsletterId: string, lang: Lang): Promise<string> {
  const file = newsletterBucket.file(newsletterFilePath(newsletterId, lang));
  const [url] = await file.getSignedUrl({
    action: 'write',
    expires: Date.now() + NEWSLETTER_UPLOAD_TTL_MS,
    contentType: 'application/pdf',
    version: 'v4',
  });
  return url;
}

export async function getNewsletterSignedDownloadUrl(newsletterId: string, lang: Lang): Promise<string> {
  const file = newsletterBucket.file(newsletterFilePath(newsletterId, lang));
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + NEWSLETTER_DOWNLOAD_TTL_MS,
  });
  return url;
}

export async function allNewsletterFilesExist(newsletterId: string, langs: readonly Lang[]): Promise<boolean> {
  const results = await Promise.all(
    langs.map(lang => newsletterBucket.file(newsletterFilePath(newsletterId, lang)).exists())
  );
  return results.every(([exists]) => exists);
}
