export const API_URL  = process.env.API_URL  ?? 'https://api.alfaraglobal.com';
export const SITE_URL = process.env.SITE_URL ?? 'https://alfaraglobal.com';

export const VALID_LANGS = ['en', 'es', 'fr', 'ca'] as const;
export type Lang = typeof VALID_LANGS[number];

export const RENTAL_TYPES = ['individual_rooms', 'whole_house', 'room_in_your_home'] as const;
export type RentalType = typeof RENTAL_TYPES[number];

export const ACCOMMODATION_TYPES = ['room_in_shared_flat', 'entire_apartment', 'co_living', 'student_residence', 'i_trust_you'] as const;
export type AccommodationType = typeof ACCOMMODATION_TYPES[number];

export const LOCATION_PREFERENCES = ['university', 'metro', 'center', 'green_area', 'i_trust_you'] as const;
export type LocationPreference = typeof LOCATION_PREFERENCES[number];

export const HOME_VIBES = ['quiet', 'social', 'between'] as const;
export type HomeVibe = typeof HOME_VIBES[number];

export const DAILY_RHYTHMS = ['early_bird', 'night_owl', 'flexible'] as const;
export type DailyRhythm = typeof DAILY_RHYTHMS[number];
