import { Resend } from 'resend';
import { API_URL, SITE_URL, VALID_LANGS, type Lang, type RentalType } from './config';
import type { SubscriptionPlan } from './stripe';

export interface LandlordPayload {
  name: string;
  surname: string;
  email: string;
  location: string;
  international_students: boolean;
  rental_type: RentalType[];
  lang: Lang;
  middle_name?: string;
  phone?: string;
  comments?: string;
  marketing_consent: boolean;
}

const resendSend = new Resend(process.env.RESEND_SEND_KEY!);
const resendFull = new Resend(process.env.RESEND_FULL_KEY!);

export type NewsletterContact = { email: string; lang: Lang };

export async function addNewsletterContact(email: string, lang: Lang): Promise<void> {
  await resendFull.contacts.create({ email, unsubscribed: false, lastName: lang });
}

export async function removeNewsletterContact(email: string): Promise<void> {
  await resendFull.contacts.remove({ email });
}

export async function listNewsletterContacts(): Promise<NewsletterContact[]> {
  const result = await resendFull.contacts.list();
  const contacts = result.data?.data ?? [];
  return contacts
    .filter(c => !c.unsubscribed)
    .map(c => ({
      email: c.email,
      lang: VALID_LANGS.includes(c.last_name as Lang) ? c.last_name as Lang : 'en',
    }));
}

interface EmailPayload {
  to: string;
  template: { id: string; variables?: Record<string, string | number> };
}

async function sendEmail(label: string, payload: EmailPayload): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[resend:dev] ${label}`, { to: payload.to, templateId: payload.template.id, variables: payload.template.variables });
    return;
  }
  const { error } = await resendSend.emails.send(payload);
  if (error) throw new Error(`[resend] ${label}: ${error.message}`);
}

// When additional language templates are created, map them here
const LANDLORD_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_LANDLORD_EN_TPL_ID!,
  es: process.env.RESEND_LANDLORD_ES_TPL_ID!,
  fr: process.env.RESEND_LANDLORD_FR_TPL_ID!,
  ca: process.env.RESEND_LANDLORD_CA_TPL_ID!,
};

const YES_NO_LABELS: Record<Lang, {yes: string; no: string}> = {
  en: {yes: 'Yes', no: 'No'},
  es: {yes: 'Sí', no: 'No'},
  fr: {yes: 'Oui', no: 'Non'},
  ca: {yes: 'Sí', no: 'No'},
};

const RENTAL_TYPE_LABELS: Record<Lang, Record<RentalType, string>> = {
  en: {
    individual_rooms: 'Individual rooms',
    whole_house: 'Whole flat or house',
    room_in_your_home: 'A room in your home',
  },
  es: {
    individual_rooms: 'Habitaciones individuales',
    whole_house: 'Piso o casa completa',
    room_in_your_home: 'Una habitación en tu casa',
  },
  fr: {
    individual_rooms: 'Chambres individuelles',
    whole_house: 'Appartement ou maison entière',
    room_in_your_home: 'Une chambre chez vous',
  },
  ca: {
    individual_rooms: "Habitacions individuals",
    whole_house: 'Pis o casa completa',
    room_in_your_home: 'Una habitació a casa teua',
  },
};

export async function sendLandlordConfirmationEmail(email: string, lang: Lang, token: string, payload: LandlordPayload): Promise<void> {
  const confirmUrl = `${API_URL}/api/landlord-form?token=${token}&lang=${lang}`;
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  const fullName = [payload.name, payload.middle_name, payload.surname].filter(Boolean).join(' ');
  const rentalType = payload.rental_type.map(t => RENTAL_TYPE_LABELS[lang][t]).join(', ');

  await sendEmail('sendLandlordConfirmationEmail', {
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
        INTERNATIONAL_STUDENTS: payload.international_students ? YES_NO_LABELS[lang].yes : YES_NO_LABELS[lang].no,
        PERSONAL_DATA_COMMERCIAL: payload.marketing_consent ? YES_NO_LABELS[lang].yes : YES_NO_LABELS[lang].no,
        RENTAL_TYPE: rentalType,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
      },
    },
  });
}

const PREMIUM_CHECKOUT_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_PREMIUM_CHECKOUT_EN_TPL_ID!,
  es: process.env.RESEND_PREMIUM_CHECKOUT_ES_TPL_ID!,
  fr: process.env.RESEND_PREMIUM_CHECKOUT_FR_TPL_ID!,
  ca: process.env.RESEND_PREMIUM_CHECKOUT_CA_TPL_ID!,
};

const STUDENT_FORM_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_STUDENT_FORM_EN_TPL_ID!,
  es: process.env.RESEND_STUDENT_FORM_ES_TPL_ID!,
  fr: process.env.RESEND_STUDENT_FORM_FR_TPL_ID!,
  ca: process.env.RESEND_STUDENT_FORM_CA_TPL_ID!,
};

type SendPremiumOptions = {
  formOnly?: boolean;
  monthlyUrl?: string;
  yearlyUrl?: string;
};

export async function sendPremiumCheckoutEmail(email: string, lang: Lang, name: string, formToken: string, options: SendPremiumOptions): Promise<void> {
  const { formOnly = false, monthlyUrl = '', yearlyUrl = '' } = options;

  const langPrefix = lang === 'en' ? '' : `/${lang}`;
  const formUrl = `${SITE_URL}${langPrefix}/housing/student-form?token=${formToken}`;

  const templateId = formOnly ? STUDENT_FORM_TEMPLATE_ID[lang] : PREMIUM_CHECKOUT_TEMPLATE_ID[lang];

  const variables: Record<string, string> = formOnly
    ? { NAME: name, FORM_URL: formUrl }
    : { NAME: name, MONTHLY_URL: monthlyUrl, YEARLY_URL: yearlyUrl, FORM_URL: formUrl };

  await sendEmail('sendPremiumCheckoutEmail', {
    to: email,
    template: {
      id: templateId,
      variables: variables,
    },
  });
}

const CUSTOMER_PORTAL_DEFAULT_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_CUSTOMER_PORTAL_DEFAULT_EN_TPL_ID!,
  es: process.env.RESEND_CUSTOMER_PORTAL_DEFAULT_ES_TPL_ID!,
  fr: process.env.RESEND_CUSTOMER_PORTAL_DEFAULT_FR_TPL_ID!,
  ca: process.env.RESEND_CUSTOMER_PORTAL_DEFAULT_CA_TPL_ID!,
};

const CUSTOMER_PORTAL_PREMIUM_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_CUSTOMER_PORTAL_PREMIUM_EN_TPL_ID!,
  es: process.env.RESEND_CUSTOMER_PORTAL_PREMIUM_ES_TPL_ID!,
  fr: process.env.RESEND_CUSTOMER_PORTAL_PREMIUM_FR_TPL_ID!,
  ca: process.env.RESEND_CUSTOMER_PORTAL_PREMIUM_CA_TPL_ID!,
};

export async function sendCustomerPortalEmail(email: string, lang: Lang, portalUrl: string, hasPremium: boolean): Promise<void> {
  const templateId = hasPremium
    ? CUSTOMER_PORTAL_PREMIUM_TEMPLATE_ID[lang]
    : CUSTOMER_PORTAL_DEFAULT_TEMPLATE_ID[lang];

  await sendEmail('sendCustomerPortalEmail', {
    to: email,
    template: {
      id: templateId,
      variables: { PORTAL_URL: portalUrl },
    },
  });
}

const WELCOME_TEMPLATE_ID: Record<SubscriptionPlan, Record<Lang, string>> = {
  basic: {
    en: process.env.RESEND_WELCOME_BASIC_EN_TPL_ID!,
    es: process.env.RESEND_WELCOME_BASIC_ES_TPL_ID!,
    fr: process.env.RESEND_WELCOME_BASIC_FR_TPL_ID!,
    ca: process.env.RESEND_WELCOME_BASIC_CA_TPL_ID!,
  },
  standard: {
    en: process.env.RESEND_WELCOME_STANDARD_EN_TPL_ID!,
    es: process.env.RESEND_WELCOME_STANDARD_ES_TPL_ID!,
    fr: process.env.RESEND_WELCOME_STANDARD_FR_TPL_ID!,
    ca: process.env.RESEND_WELCOME_STANDARD_CA_TPL_ID!,
  },
  premium: {
    en: process.env.RESEND_WELCOME_PREMIUM_EN_TPL_ID!,
    es: process.env.RESEND_WELCOME_PREMIUM_ES_TPL_ID!,
    fr: process.env.RESEND_WELCOME_PREMIUM_FR_TPL_ID!,
    ca: process.env.RESEND_WELCOME_PREMIUM_CA_TPL_ID!,
  },
};

export async function sendWelcomeEmail(email: string, lang: Lang, plan: SubscriptionPlan): Promise<void> {
  const langPrefix = lang === 'en' ? '' : `/${lang}`;
  const variables: Record<string, string> | undefined =
    plan === 'premium'
      ? { PORTAL_REQUEST_URL: `${SITE_URL}${langPrefix}/community/manage-subscription`, WHATSAPP_COMMUNITY: process.env.WHATSAPP_COMMUNITY!, WHATSAPP_STUDENTS: process.env.WHATSAPP_STUDENTS! }
      : plan === 'standard'
      ? { PORTAL_REQUEST_URL: `${SITE_URL}${langPrefix}/community/manage-subscription`, WHATSAPP_COMMUNITY: process.env.WHATSAPP_COMMUNITY! }
      : undefined;
  await sendEmail('sendWelcomeEmail', {
    to: email,
    template: {
      id: WELCOME_TEMPLATE_ID[plan][lang],
      ...(variables ? { variables } : {}),
    },
  });
}

const UPDATE_FROM_BASIC_TO_STANDARD_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_UPDATE_FROM_BASIC_TO_STANDARD_EN_TPL_ID!,
  es: process.env.RESEND_UPDATE_FROM_BASIC_TO_STANDARD_ES_TPL_ID!,
  fr: process.env.RESEND_UPDATE_FROM_BASIC_TO_STANDARD_FR_TPL_ID!,
  ca: process.env.RESEND_UPDATE_FROM_BASIC_TO_STANDARD_CA_TPL_ID!,
};

export async function sendUpdateFromBasicToStandardEmail(email: string, lang: Lang): Promise<void> {
  const langPrefix = lang === 'en' ? '' : `/${lang}`;
  await sendEmail('sendUpdateFromBasicToStandardEmail', {
    to: email,
    template: {
      id: UPDATE_FROM_BASIC_TO_STANDARD_TEMPLATE_ID[lang],
      variables: { PORTAL_REQUEST_URL: `${SITE_URL}${langPrefix}/community/manage-subscription`, WHATSAPP_COMMUNITY: process.env.WHATSAPP_COMMUNITY! },
    },
  });
}

const UPDATE_FROM_STANDARD_TO_BASIC_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_UPDATE_FROM_STANDARD_TO_BASIC_EN_TPL_ID!,
  es: process.env.RESEND_UPDATE_FROM_STANDARD_TO_BASIC_ES_TPL_ID!,
  fr: process.env.RESEND_UPDATE_FROM_STANDARD_TO_BASIC_FR_TPL_ID!,
  ca: process.env.RESEND_UPDATE_FROM_STANDARD_TO_BASIC_CA_TPL_ID!,
};

export async function sendUpdateFromStandardToBasicEmail(email: string, lang: Lang): Promise<void> {
  await sendEmail('sendUpdateFromStandardToBasicEmail', { to: email, template: { id: UPDATE_FROM_STANDARD_TO_BASIC_TEMPLATE_ID[lang] } });
}

const PHONE_NUMBER_COMPLETE_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_PHONE_NUMBER_COMPLETE_EN_TPL_ID!,
  es: process.env.RESEND_PHONE_NUMBER_COMPLETE_ES_TPL_ID!,
  fr: process.env.RESEND_PHONE_NUMBER_COMPLETE_FR_TPL_ID!,
  ca: process.env.RESEND_PHONE_NUMBER_COMPLETE_CA_TPL_ID!,
};

export async function sendPhoneNumberCompleteEmail(email: string, lang: Lang): Promise<void> {
  await sendEmail('sendPhoneNumberCompleteEmail', { to: email, template: { id: PHONE_NUMBER_COMPLETE_TEMPLATE_ID[lang] } });
}

const NEWSLETTER_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_NEWSLETTER_EN_TPL_ID!,
  es: process.env.RESEND_NEWSLETTER_ES_TPL_ID!,
  fr: process.env.RESEND_NEWSLETTER_FR_TPL_ID!,
  ca: process.env.RESEND_NEWSLETTER_CA_TPL_ID!,
};

export type NewsletterBatchItem = {
  email: string;
  lang: Lang;
  downloadUrls: Record<Lang, string>;
  unsubUrl: string;
};

export async function sendNewsletterBatch(items: NewsletterBatchItem[]): Promise<void> {
  if (items.length > 100) throw new Error(`[resend] sendNewsletterBatch: max 100 items, got ${items.length}`);
  const emails = items.map(({ email, lang, downloadUrls, unsubUrl }) => ({
    to: email,
    template: {
      id: NEWSLETTER_TEMPLATE_ID[lang],
      variables: {
        DOWNLOAD_EN: downloadUrls.en,
        DOWNLOAD_ES: downloadUrls.es,
        DOWNLOAD_FR: downloadUrls.fr,
        DOWNLOAD_CA: downloadUrls.ca,
        UNSUB_URL: unsubUrl,
        COMPANY_NAME: process.env.COMPANY_NAME!,
        COMPANY_ADDRESS: process.env.COMPANY_ADDRESS!,
      },
    },
  }));

  if (process.env.NODE_ENV === 'development') {
    console.log('[resend:dev] sendNewsletterBatch', emails.length, 'emails', JSON.stringify(emails[0], null, 2));
    return;
  }

  const { error } = await resendSend.batch.send(emails);
  if (error) throw new Error(`[resend] sendNewsletterBatch: ${JSON.stringify(error)}`);
}
