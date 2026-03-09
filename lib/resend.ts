import { Resend } from 'resend';
import { API_URL, type Lang } from './config';

const resendSend  = new Resend(process.env.RESEND_SEND_KEY!);
const resendAdmin = new Resend(process.env.RESEND_KEY!);

const CONFIRMATION_TPL_ID = process.env.RESEND_CONFIRMATION_TPL_ID!;

// When additional language templates are created, map them here
const TEMPLATE_ID: Record<Lang, string> = {
  en:  CONFIRMATION_TPL_ID,
  es:  CONFIRMATION_TPL_ID,
  fr:  CONFIRMATION_TPL_ID,
  cat: CONFIRMATION_TPL_ID,
};

export async function sendConfirmationEmail(email: string, lang: Lang, token: string): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm?token=${token}&lang=${lang}`;

  await resendSend.emails.send({
    to: email,
    template: {
      id: TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
      },
    },
  });
}

export async function addContact(email: string): Promise<void> {
  await resendAdmin.contacts.create({
    email,
    unsubscribed: false,
  });
}
