import { Resend } from 'resend';
import { API_URL, SITE_URL, type Lang, type RentalType } from './config';
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
}

const resendSend = new Resend(process.env.RESEND_SEND_KEY!);

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
  const confirmUrl = `${API_URL}/api/confirm-landlord-form?token=${token}&lang=${lang}`;
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  const fullName = [payload.name, payload.middle_name, payload.surname].filter(Boolean).join(' ');
  const rentalType = payload.rental_type.map(t => RENTAL_TYPE_LABELS[lang][t]).join(', ');

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
        INTERNATIONAL_STUDENTS: payload.international_students ? YES_NO_LABELS[lang].yes : YES_NO_LABELS[lang].no,
        RENTAL_TYPE: rentalType,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
      },
    },
  });
  if (error) throw new Error(`[resend] sendLandlordConfirmationEmail: ${error.message}`);
}

const PREMIUM_CHECKOUT_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_PREMIUM_CHECKOUT_EN_TPL_ID!,
  es: process.env.RESEND_PREMIUM_CHECKOUT_ES_TPL_ID!,
  fr: process.env.RESEND_PREMIUM_CHECKOUT_FR_TPL_ID!,
  ca: process.env.RESEND_PREMIUM_CHECKOUT_CA_TPL_ID!,
};

export async function sendPremiumCheckoutEmail(email: string, lang: Lang, name: string, monthlyUrl: string, yearlyUrl: string, formToken: string): Promise<void> {
  const langPrefix = lang === 'en' ? '' : `/${lang}`;

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: PREMIUM_CHECKOUT_TEMPLATE_ID[lang],
      variables: {
        NAME: name,
        MONTHLY_URL: monthlyUrl,
        YEARLY_URL: yearlyUrl,
        FORM_URL: `${SITE_URL}${langPrefix}/student-housing-form?token=${formToken}`,
      },
    },
  });
  if (error) throw new Error(`[resend] sendPremiumCheckoutEmail: ${error.message}`);
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

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: templateId,
      variables: { PORTAL_URL: portalUrl },
    },
  });
  if (error) throw new Error(`[resend] sendCustomerPortalEmail: ${error.message}`);
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
  const { error } = await resendSend.emails.send({
    to: email,
    template: { id: WELCOME_TEMPLATE_ID[plan][lang] },
  });
  if (error) throw new Error(`[resend] sendWelcomeEmail: ${error.message}`);
}

