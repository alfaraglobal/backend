import { Resend } from 'resend';
import { API_URL, type Lang } from './config';

export interface LandlordPayload {
  name: string;
  surname: string;
  email: string;
  location: string;
  international_students: boolean;
  rental_type: string[];
  middle_name?: string;
  phone?: string;
  comments?: string;
}

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

const LANDLORD_TPL_ID = process.env.RESEND_LANDLORD_TPL_ID!;

// When additional language templates are created, map them here
const LANDLORD_TEMPLATE_ID: Record<Lang, string> = {
  en: LANDLORD_TPL_ID,
  es: LANDLORD_TPL_ID,
  fr: LANDLORD_TPL_ID,
  cat: LANDLORD_TPL_ID,
};

const RENTAL_TYPE_LABELS: Record<string, string> = {
  rooms: 'Individual rooms',
  whole: 'Whole property',
  room_in_home: 'Room in home',
};

export async function sendLandlordConfirmationEmail(email: string, lang: Lang, token: string, payload: LandlordPayload): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm-landlord?token=${token}&lang=${lang}`;

  const fullName = [payload.name, payload.middle_name, payload.surname].filter(Boolean).join(' ');
  const rentalType = payload.rental_type.map(t => RENTAL_TYPE_LABELS[t] ?? t).join(', ');

  await resendSend.emails.send({
    to: email,
    template: {
      id: LANDLORD_TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
        NAME: payload.name,
        FULL_NAME: fullName,
        EMAIL_ADDRESS: payload.email,
        PROPERTY_LOCATION: payload.location,
        INTERNATIONAL_STUDENTS: payload.international_students ? 'Yes' : 'No',
        RENTAL_TYPE: rentalType,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
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
