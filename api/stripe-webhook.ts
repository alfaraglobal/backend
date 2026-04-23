import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe, getPlanFromProductId } from '../lib/stripe';
import { sendWelcomeEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

export const config = { api: { bodyParser: false } };

function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).end('Missing stripe-signature header');

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err);
    return res.status(400).end('Webhook signature verification failed');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (customerId && session.metadata) {
      const { email, phone, language } = session.metadata;
      const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';

      try {
        await stripe.customers.update(customerId, {
          metadata: {
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
            ...(language ? { language } : {}),
          },
        });
      } catch (err) {
        console.error('[stripe-webhook] failed to update customer metadata:', err);
        return res.status(500).end('Failed to update customer');
      }

      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (subscriptionId && email) {
        try {
          const [subscription, allSubs] = await Promise.all([
            stripe.subscriptions.retrieve(subscriptionId),
            stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 2 }),
          ]);
          const productId = subscription.items.data[0]?.price.product as string;
          const plan = getPlanFromProductId(productId);
          const isFirstSubscription = allSubs.data.length === 1;
          if (plan && isFirstSubscription) await sendWelcomeEmail(email, lang, plan);
        } catch (err) {
          console.error('[stripe-webhook] failed to send welcome email:', err);
        }
      }
    }
  }

  return res.status(200).json({ received: true });
}
