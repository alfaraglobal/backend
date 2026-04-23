import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe, getPlanFromProductId, type PaymentStatus, type WhatsappStatus, type WhatsappRemoval } from '../lib/stripe';
import { sendWelcomeEmail, sendUpgradeToStandardEmail, sendDowngradeToBasicEmail } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';

export const config = { api: { bodyParser: false } };

type StripeEvent = ReturnType<typeof stripe.webhooks.constructEvent>;
type CheckoutSession = Extract<StripeEvent, { type: 'checkout.session.completed' }>['data']['object'];
type Invoice = Extract<StripeEvent, { type: 'invoice.paid' }>['data']['object'];
type Subscription = Extract<StripeEvent, { type: 'customer.subscription.deleted' }>['data']['object'];
type SubscriptionUpdatedData = Extract<StripeEvent, { type: 'customer.subscription.updated' }>['data'];
type SubscriptionUpdated = SubscriptionUpdatedData['object'];

function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function onCheckoutSessionCompleted(session: CheckoutSession) {
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId || !session.metadata) return;

  const { email, phone, language } = session.metadata;
  const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

  let plan = null;
  let isFirstSubscription = false;
  if (subscriptionId) {
    try {
      const [subscription, allSubs] = await Promise.all([
        stripe.subscriptions.retrieve(subscriptionId),
        stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 2 }),
      ]);
      plan = getPlanFromProductId(subscription.items.data[0]?.price.product as string);
      isFirstSubscription = allSubs.data.length === 1;
    } catch (err) {
      console.error('[stripe-webhook] failed to retrieve subscription:', err);
      throw err;
    }
  }

  const isWhatsappPlan = plan === 'standard' || plan === 'premium';
  const whatsappStatus: WhatsappStatus | null = isWhatsappPlan ? (phone ? 'false' : '') : null;

  try {
    await stripe.customers.update(customerId, {
      metadata: {
        payment_status: 'active' satisfies PaymentStatus,
        needs_whatsapp_removal: 'false' satisfies WhatsappRemoval,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(whatsappStatus !== null ? { added_to_whatsapp: whatsappStatus } : {}),
        ...(language ? { language } : {}),
      },
    });
  } catch (err) {
    console.error('[stripe-webhook] failed to update customer metadata:', err);
    throw err;
  }

  if (email && plan && isFirstSubscription) {
    try {
      await sendWelcomeEmail(email, lang, plan);
    } catch (err) {
      console.error('[stripe-webhook] failed to send welcome email:', err);
    }
  }
}

async function onInvoicePaymentFailed(invoice: Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.parent?.subscription_details?.subscription) return;

  try {
    await stripe.customers.update(customerId, { metadata: { payment_status: 'failing' satisfies PaymentStatus } });
  } catch (err) {
    console.error('[stripe-webhook] failed to set payment_status failing:', err);
  }
}

async function onInvoicePaid(invoice: Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.parent?.subscription_details?.subscription) return;

  try {
    await stripe.customers.update(customerId, { metadata: { payment_status: 'active' satisfies PaymentStatus } });
  } catch (err) {
    console.error('[stripe-webhook] failed to set payment_status active:', err);
  }
}

async function onSubscriptionDeleted(subscription: Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

  const productId = subscription.items.data[0]?.price.product as string;
  const plan = getPlanFromProductId(productId);
  const isWhatsappPlan = plan === 'standard' || plan === 'premium';

  try {
    await stripe.customers.update(customerId, {
      metadata: {
        payment_status: 'canceled' satisfies PaymentStatus,
        ...(isWhatsappPlan ? { needs_whatsapp_removal: 'true' satisfies WhatsappRemoval } : {}),
      },
    });
  } catch (err) {
    console.error('[stripe-webhook] failed to update metadata on subscription deletion:', err);
  }
}

async function onSubscriptionUpdated(subscription: SubscriptionUpdated, previousAttributes: SubscriptionUpdatedData['previous_attributes']) {
  if (!previousAttributes?.items) return;

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

  const newProductId = subscription.items.data[0]?.price.product as string;
  const oldProductId = previousAttributes.items.data[0]?.price.product as string;
  const newPlan = getPlanFromProductId(newProductId);
  const oldPlan = getPlanFromProductId(oldProductId);

  const isUpgrade = oldPlan === 'basic' && newPlan === 'standard';
  const isDowngrade = oldPlan === 'standard' && newPlan === 'basic';
  if (!isUpgrade && !isDowngrade) return;

  let customer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    console.error('[stripe-webhook] failed to retrieve customer:', err);
    throw err;
  }
  if ('deleted' in customer) return;

  const email = customer.metadata?.['email'] as string | undefined;
  const language = customer.metadata?.['language'] as string | undefined;
  const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';

  if (isUpgrade || isDowngrade) {
    try {
      await stripe.customers.update(customerId, {
        metadata: {
          ...(isUpgrade ? { added_to_whatsapp: '' satisfies WhatsappStatus } : {}),
          ...(isDowngrade ? { needs_whatsapp_removal: 'true' satisfies WhatsappRemoval } : {}),
        },
      });
    } catch (err) {
      console.error('[stripe-webhook] failed to update metadata on plan change:', err);
      throw err;
    }
  }

  if (email) {
    try {
      if (isUpgrade) {
        await sendUpgradeToStandardEmail(email, lang);
      } else {
        await sendDowngradeToBasicEmail(email, lang);
      }
    } catch (err) {
      console.error('[stripe-webhook] failed to send plan change email:', err);
    }
  }
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

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutSessionCompleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event.data.object);
        break;
      case 'invoice.paid':
        await onInvoicePaid(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await onSubscriptionUpdated(event.data.object, event.data.previous_attributes);
        break;
    }
  } catch (err) {
    return res.status(500).end('Internal server error');
  }

  return res.status(200).json({ received: true });
}
