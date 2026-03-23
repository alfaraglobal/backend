import { Resend } from 'resend';
import { API_URL, SITE_URL, type Lang } from './config';

export interface LandlordPayload {
  name: string;
  surname: string;
  email: string;
  location: string;
  international_students: boolean;
  rental_type: string[];
  lang: Lang;
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

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
      },
    },
  });
  if (error) console.error('[resend] sendConfirmationEmail failed:', error);
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
  individual_rooms: 'Individual rooms',
  whole_house: 'Whole flat or house',
  room_in_your_home: 'A room in your home',
};

export async function sendLandlordConfirmationEmail(email: string, lang: Lang, token: string, payload: LandlordPayload): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm-landlord?token=${token}&lang=${lang}`;
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  const fullName = [payload.name, payload.middle_name, payload.surname].filter(Boolean).join(' ');
  const rentalType = payload.rental_type.map(t => RENTAL_TYPE_LABELS[t] ?? t).join(', ');

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: LANDLORD_TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
        FORM_URL: `${SITE_URL}${langPrefix}/housing/landlord#landlord-form-intro`,
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
  if (error) console.error('[resend] sendLandlordConfirmationEmail failed:', error);
}

export interface StudentPayload {
  name: string;
  surname: string;
  email: string;
  nationality: string;
  arrival_date: string;
  departure_date: string;
  accommodation_type: string;
  location_preference: string;
  budget: number;
  newsletter: boolean;
  lang: Lang;
  middle_name?: string;
  phone?: string;
  home_vibe?: string;
  daily_rhythm?: string;
  comments?: string;
}

const STUDENT_TPL_ID = process.env.RESEND_STUDENT_TPL_ID!;
const STUDENT_NEWSLETTER_TPL_ID = process.env.RESEND_STUDENT_NEWSLETTER_TPL_ID!;

const STUDENT_TEMPLATE_ID: Record<Lang, string> = {
  en: STUDENT_TPL_ID,
  es: STUDENT_TPL_ID,
  fr: STUDENT_TPL_ID,
  cat: STUDENT_TPL_ID,
};

const STUDENT_NEWSLETTER_TEMPLATE_ID: Record<Lang, string> = {
  en: STUDENT_NEWSLETTER_TPL_ID,
  es: STUDENT_NEWSLETTER_TPL_ID,
  fr: STUDENT_NEWSLETTER_TPL_ID,
  cat: STUDENT_NEWSLETTER_TPL_ID,
};

const ACCOMMODATION_TYPE_LABELS: Record<string, string> = {
  room_in_shared_flat: 'Room in a shared flat',
  entire_apartment: 'Entire apartment',
  co_living: 'Co-living',
  student_residence: 'Student residence',
  i_trust_you: 'Doesn\'t matter, I trust you',
};

const LOCATION_PREFERENCE_LABELS: Record<string, string> = {
  university: 'Next to the University',
  metro: 'Close to the Metro station',
  center: 'Center',
  green_area: 'Near green areas',
  i_trust_you: 'Doesn\'t matter, I trust you',
};

const HOME_VIBE_LABELS: Record<string, string> = {
  quiet: 'Quiet and tidy',
  social: 'Social and lively',
  between: 'Somewhere in between',
};

const DAILY_RHYTHM_LABELS: Record<string, string> = {
  early_bird: 'Early bird',
  night_owl: 'Night owl',
  flexible: 'Flexible',
};

export async function sendStudentConfirmationEmail(email: string, lang: Lang, token: string, payload: StudentPayload, newsletter: boolean): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm-student?token=${token}&lang=${lang}${newsletter ? '&newsletter=1' : ''}`;
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  const fullName = [payload.name, payload.middle_name, payload.surname].filter(Boolean).join(' ');

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: newsletter ? STUDENT_NEWSLETTER_TEMPLATE_ID[lang] : STUDENT_TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
        FORM_URL: newsletter ? `${SITE_URL}${langPrefix}/housing/student?newsletter=1#student-form-intro` : `${SITE_URL}${langPrefix}/housing/student#student-form-intro`,
        NAME: payload.name,
        FULL_NAME: fullName,
        EMAIL_ADDRESS: payload.email,
        NATIONALITY: payload.nationality,
        ARRIVAL_DATE: payload.arrival_date,
        DEPARTURE_DATE: payload.departure_date,
        ACCOMMODATION_TYPE: ACCOMMODATION_TYPE_LABELS[payload.accommodation_type] ?? payload.accommodation_type,
        LOCATION_PREFERENCE: LOCATION_PREFERENCE_LABELS[payload.location_preference] ?? payload.location_preference,
        BUDGET: `€${payload.budget}`,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.home_vibe ? { HOME_VIBE: HOME_VIBE_LABELS[payload.home_vibe] ?? payload.home_vibe } : {}),
        ...(payload.daily_rhythm ? { DAILY_RHYTHM: DAILY_RHYTHM_LABELS[payload.daily_rhythm] ?? payload.daily_rhythm } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
      },
    },
  });
  if (error) console.error('[resend] sendStudentConfirmationEmail failed:', error);
}

const SEGMENT_ID: Record<Lang, string | undefined> = {
  en: process.env.RESEND_SEGMENT_EN_ID,
  fr: process.env.RESEND_SEGMENT_FR_ID,
  es: process.env.RESEND_SEGMENT_ES_ID,
  cat: process.env.RESEND_SEGMENT_ES_ID,
};

interface AddContactOptions {
  email: string;
  lang: Lang;
  firstName?: string;
  lastName?: string;
}

export async function addContact({ email, lang, firstName, lastName }: AddContactOptions): Promise<void> {
  const segmentId = SEGMENT_ID[lang] ?? SEGMENT_ID['en'];

  const { error } = await resendAdmin.contacts.create({
    email,
    unsubscribed: false,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
  });
  if (error) console.error('[resend] addContact failed:', error);
}
