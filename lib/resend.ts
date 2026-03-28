import { Resend } from 'resend';
import { API_URL, SITE_URL, type Lang, type RentalType, type AccommodationType, type LocationPreference, type HomeVibe, type DailyRhythm } from './config';

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
const resendAdmin = new Resend(process.env.RESEND_KEY!);

// When additional language templates are created, map them here
const NEWSLETTER_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_NEWSLETTER_EN_TPL_ID!,
  es: process.env.RESEND_NEWSLETTER_ES_TPL_ID!,
  fr: process.env.RESEND_NEWSLETTER_FR_TPL_ID!,
  ca: process.env.RESEND_NEWSLETTER_CA_TPL_ID!,
};

export async function sendNewsletterConfirmationEmail(email: string, lang: Lang, token: string): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm-newsletter?token=${token}&lang=${lang}`;

  const { error } = await resendSend.emails.send({
    to: email,
    template: {
      id: NEWSLETTER_TEMPLATE_ID[lang],
      variables: {
        CONFIRM_URL: confirmUrl,
      },
    },
  });
  if (error) throw new Error(`[resend] sendNewsletterConfirmationEmail: ${error.message}`);
}

// When additional language templates are created, map them here
const LANDLORD_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_LANDLORD_EN_TPL_ID!,
  es: process.env.RESEND_LANDLORD_ES_TPL_ID!,
  fr: process.env.RESEND_LANDLORD_FR_TPL_ID!,
  ca: process.env.RESEND_LANDLORD_CA_TPL_ID!,
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
        INTERNATIONAL_STUDENTS: payload.international_students ? 'Yes' : 'No',
        RENTAL_TYPE: rentalType,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
      },
    },
  });
  if (error) throw new Error(`[resend] sendLandlordConfirmationEmail: ${error.message}`);
}

export interface StudentPayload {
  name: string;
  surname: string;
  email: string;
  nationality: string;
  arrival_date: string;
  departure_date: string;
  accommodation_type: AccommodationType;
  location_preference: LocationPreference;
  budget: number;
  newsletter: boolean;
  lang: Lang;
  middle_name?: string;
  phone?: string;
  home_vibe?: HomeVibe;
  daily_rhythm?: DailyRhythm;
  comments?: string;
}

const STUDENT_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_STUDENT_EN_TPL_ID!,
  es: process.env.RESEND_STUDENT_ES_TPL_ID!,
  fr: process.env.RESEND_STUDENT_FR_TPL_ID!,
  ca: process.env.RESEND_STUDENT_CA_TPL_ID!,
};

const STUDENT_NEWSLETTER_TEMPLATE_ID: Record<Lang, string> = {
  en: process.env.RESEND_STUDENT_NEWSLETTER_EN_TPL_ID!,
  es: process.env.RESEND_STUDENT_NEWSLETTER_ES_TPL_ID!,
  fr: process.env.RESEND_STUDENT_NEWSLETTER_FR_TPL_ID!,
  ca: process.env.RESEND_STUDENT_NEWSLETTER_CA_TPL_ID!,
};

const ACCOMMODATION_TYPE_LABELS: Record<Lang, Record<AccommodationType, string>> = {
  en: {
    room_in_shared_flat: 'Room in a shared flat',
    entire_apartment: 'Entire apartment',
    co_living: 'Co-living',
    student_residence: 'Student residence',
    i_trust_you: 'Doesn\'t matter, I trust you',
  },
  es: {
    room_in_shared_flat: 'Habitación en piso compartido',
    entire_apartment: 'Piso completo',
    co_living: 'Co-living',
    student_residence: 'Residencia de estudiantes',
    i_trust_you: 'No importa, confío en vosotros',
  },
  fr: {
    room_in_shared_flat: 'Chambre en colocation',
    entire_apartment: 'Appartement entier',
    co_living: 'Co-living',
    student_residence: 'Résidence étudiante',
    i_trust_you: 'Peu importe, je vous fais confiance',
  },
  ca: {
    room_in_shared_flat: 'Habitació en pis compartit',
    entire_apartment: 'Pis complet',
    co_living: 'Co-living',
    student_residence: 'Residència d\'estudiants',
    i_trust_you: 'No importa, confie en vosaltres',
  },
};

const LOCATION_PREFERENCE_LABELS: Record<Lang, Record<LocationPreference, string>> = {
  en: {
    university: 'Next to CEU',
    metro: 'Close to the Metro station',
    center: 'Center',
    green_area: 'Near green areas',
    i_trust_you: 'Doesn\'t matter, I trust you',
  },
  es: {
    university: 'Junto al CEU',
    metro: 'Cerca de la estación de Metro',
    center: 'Centro',
    green_area: 'Cerca de zonas verdes',
    i_trust_you: 'No importa, confío en vosotros',
  },
  fr: {
    university: 'À côté de l\'Université',
    metro: 'Près de la station de Métro',
    center: 'Centre-ville',
    green_area: 'Près des espaces verts',
    i_trust_you: 'Peu importe, je vous fais confiance',
  },
  ca: {
    university: 'Al costat del CEU',
    metro: 'Prop de l\'estació de Metro',
    center: 'Centre',
    green_area: 'Prop de zones verdes',
    i_trust_you: 'No importa, confie en vosaltres',
  },
};

const HOME_VIBE_LABELS: Record<Lang, Record<HomeVibe, string>> = {
  en: {
    quiet: 'Quiet and tidy',
    social: 'Social and lively',
    between: 'Somewhere in between',
  },
  es: {
    quiet: 'Tranquilo y ordenado',
    social: 'Social y animado',
    between: 'Término medio',
  },
  fr: {
    quiet: 'Calme et ordonné',
    social: 'Social et animé',
    between: 'Entre les deux',
  },
  ca: {
    quiet: 'Tranquil i ordenat',
    social: 'Social i animat',
    between: 'Terme mig',
  },
};

const DAILY_RHYTHM_LABELS: Record<Lang, Record<DailyRhythm, string>> = {
  en: {
    early_bird: 'Early bird',
    night_owl: 'Night owl',
    flexible: 'Flexible',
  },
  es: {
    early_bird: 'Madrugador',
    night_owl: 'Noctámbulo',
    flexible: 'Flexible',
  },
  fr: {
    early_bird: 'Lève-tôt',
    night_owl: 'Couche-tard',
    flexible: 'Flexible',
  },
  ca: {
    early_bird: 'Matiner',
    night_owl: 'Nocturn',
    flexible: 'Flexible',
  },
};

export async function sendStudentConfirmationEmail(email: string, lang: Lang, token: string, payload: StudentPayload, newsletter: boolean): Promise<void> {
  const confirmUrl = `${API_URL}/api/confirm-student-form?token=${token}&lang=${lang}${newsletter ? '&newsletter=1' : ''}`;
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
        ACCOMMODATION_TYPE: ACCOMMODATION_TYPE_LABELS[lang][payload.accommodation_type],
        LOCATION_PREFERENCE: LOCATION_PREFERENCE_LABELS[lang][payload.location_preference],
        BUDGET: `€${payload.budget}`,
        ...(payload.phone ? { PHONE: payload.phone } : {}),
        ...(payload.home_vibe ? { HOME_VIBE: HOME_VIBE_LABELS[lang][payload.home_vibe] } : {}),
        ...(payload.daily_rhythm ? { DAILY_RHYTHM: DAILY_RHYTHM_LABELS[lang][payload.daily_rhythm] } : {}),
        ...(payload.comments ? { COMMENTS: payload.comments } : {}),
      },
    },
  });
  if (error) throw new Error(`[resend] sendStudentConfirmationEmail: ${error.message}`);
}

const SEGMENT_ID: Record<Lang, string | undefined> = {
  en: process.env.RESEND_SEGMENT_EN_ID,
  fr: process.env.RESEND_SEGMENT_FR_ID,
  es: process.env.RESEND_SEGMENT_ES_ID,
  ca: process.env.RESEND_SEGMENT_ES_ID,
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
  if (error) throw new Error(`[resend] addContact: ${error.message}`);
}
