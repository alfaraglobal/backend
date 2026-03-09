export const API_URL  = process.env.API_URL  ?? 'https://api.alfaraglobal.com';
export const SITE_URL = process.env.SITE_URL ?? 'https://alfaraglobal.com';

export const VALID_LANGS = ['en', 'es', 'fr', 'cat'] as const;
export type Lang = typeof VALID_LANGS[number];
