import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function appendRow(spreadsheetId: string, token: string, values: (string | number | boolean)[]): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth });
  const timestamp = new Date().toISOString();

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Submissions!A:A',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[token, timestamp, ...values]],
      },
    });
  } catch (error) {
    console.error('[sheets] appendRow failed:', error);
  }
}

export async function appendStudentRow(token: string, payload: {
  lang: string;
  name: string;
  middle_name?: string;
  surname: string;
  email: string;
  phone?: string;
  nationality: string;
  arrival_date: string;
  departure_date: string;
  accommodation_type: string;
  location_preference: string;
  budget: number;
  home_vibe?: string;
  daily_rhythm?: string;
  comments?: string;
  newsletter: boolean;
}): Promise<void> {
  await appendRow(process.env.GOOGLE_SHEETS_ID_STUDENT!, token, [
    payload.lang,
    payload.name,
    payload.middle_name ?? '',
    payload.surname,
    payload.email,
    payload.phone ?? '',
    payload.nationality,
    payload.arrival_date,
    payload.departure_date,
    payload.accommodation_type,
    payload.location_preference,
    payload.budget,
    payload.home_vibe ?? '',
    payload.daily_rhythm ?? '',
    payload.comments ?? '',
    payload.newsletter ? 'Yes' : 'No',
  ]);
}

export async function appendLandlordRow(token: string, payload: {
  lang: string;
  name: string;
  middle_name?: string;
  surname: string;
  email: string;
  phone?: string;
  location: string;
  international_students: boolean;
  rental_type: string[];
  comments?: string;
}): Promise<void> {
  await appendRow(process.env.GOOGLE_SHEETS_ID_LANDLORD!, token, [
    payload.lang,
    payload.name,
    payload.middle_name ?? '',
    payload.surname,
    payload.email,
    payload.phone ?? '',
    payload.location,
    payload.international_students ? 'Yes' : 'No',
    payload.rental_type.join('; '),
    payload.comments ?? '',
  ]);
}
