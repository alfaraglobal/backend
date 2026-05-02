import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe, getPlanFromProductId, type PaymentStatus, type WhatsappStatus, type WhatsappRemoval, type WhatsappNumberOutdated, type MarketingConsent } from '../lib/stripe';
import { sendWelcomeEmail, sendUpdateFromBasicToStandardEmail, sendUpdateFromStandardToBasicEmail, sendPhoneNumberCompleteEmail, addNewsletterContact, removeNewsletterContact } from '../lib/resend';
import { VALID_LANGS, type Lang } from '../lib/config';
import { devLog } from '../lib/logger';

export const config = { api: { bodyParser: false } };

type StripeEvent = ReturnType<typeof stripe.webhooks.constructEvent>;
type CheckoutSession = Extract<StripeEvent, { type: 'checkout.session.completed' }>['data']['object'];
type Invoice = Extract<StripeEvent, { type: 'invoice.paid' }>['data']['object'];
type Subscription = Extract<StripeEvent, { type: 'customer.subscription.deleted' }>['data']['object'];
type SubscriptionUpdatedData = Extract<StripeEvent, { type: 'customer.subscription.updated' }>['data'];
type SubscriptionUpdated = SubscriptionUpdatedData['object'];
type CustomerUpdatedData = Extract<StripeEvent, { type: 'customer.updated' }>['data'];
type CustomerUpdated = CustomerUpdatedData['object'];

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

  const { phone, language, marketing_consent } = session.metadata;
  const email = session.customer_details?.email ?? undefined;
  const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';
  devLog('onCheckoutSessionCompleted: customerId:', customerId, 'email:', email, 'lang:', lang);

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

  let plan = null;
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      plan = getPlanFromProductId(subscription.items.data[0]?.price.product as string);
      devLog('onCheckoutSessionCompleted: plan:', plan);
    } catch (err) {
      console.error('[stripe-webhook] failed to retrieve subscription:', err);
      throw err;
    }
  }

  const isWhatsappPlan = plan === 'standard' || plan === 'premium';
  const whatsappStatus: WhatsappStatus | null = isWhatsappPlan ? (phone ? 'false' : 'n/a') : null;

  try {
    await stripe.customers.update(customerId, {
      ...(phone ? { phone } : {}),
      metadata: {
        payment_status: 'active' satisfies PaymentStatus,
        needs_whatsapp_removal: 'false' satisfies WhatsappRemoval,
        added_to_whatsapp: (whatsappStatus ?? 'n/a') satisfies WhatsappStatus,
        language: language ?? 'en',
        whatsapp_number: phone ?? 'n/a',
        marketing_consent: (marketing_consent === 'true' ? 'true' : 'false') satisfies MarketingConsent,
        whatsapp_number_outdated: 'false' satisfies WhatsappNumberOutdated,
      },
    });
  } catch (err) {
    console.error('[stripe-webhook] failed to update customer metadata:', err);
    throw err;
  }

  if (email && plan) {
    try {
      await sendWelcomeEmail(email, lang, plan);
      devLog('onCheckoutSessionCompleted: welcome email sent to:', email);
    } catch (err) {
      console.error('[stripe-webhook] failed to send welcome email:', err);
    }
  }

  if (email && marketing_consent === 'true') {
    try {
      await addNewsletterContact(email, lang);
      devLog('onCheckoutSessionCompleted: newsletter contact added:', email);
    } catch (err) {
      console.error('[stripe-webhook] failed to add newsletter contact:', err);
    }
  }
}

async function onInvoicePaymentFailed(invoice: Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.parent?.subscription_details?.subscription) return;
  devLog('onInvoicePaymentFailed: customerId:', customerId);

  try {
    await stripe.customers.update(customerId, { metadata: { payment_status: 'failing' satisfies PaymentStatus } });
    devLog('onInvoicePaymentFailed: payment_status set to failing');
  } catch (err) {
    console.error('[stripe-webhook] failed to set payment_status failing:', err);
  }
}

async function onInvoicePaid(invoice: Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.parent?.subscription_details?.subscription) return;
  devLog('onInvoicePaid: customerId:', customerId);

  try {
    await stripe.customers.update(customerId, { metadata: { payment_status: 'active' satisfies PaymentStatus } });
    devLog('onInvoicePaid: payment_status set to active');
  } catch (err) {
    console.error('[stripe-webhook] failed to set payment_status active:', err);
  }
}

async function onSubscriptionDeleted(subscription: Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  devLog('onSubscriptionDeleted: customerId:', customerId);

  let customer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    console.error('[stripe-webhook] failed to retrieve customer on subscription deletion:', err);
    return;
  }
  if ('deleted' in customer) return;

  const productId = subscription.items.data[0]?.price.product as string;
  const plan = getPlanFromProductId(productId);
  const isWhatsappPlan = plan === 'standard' || plan === 'premium';
  devLog('onSubscriptionDeleted: plan:', plan, 'email:', customer.email);

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

  if (customer.email) {
    try {
      await removeNewsletterContact(customer.email);
    } catch (err) {
      console.error('[stripe-webhook] failed to remove newsletter contact:', err);
    }
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
  devLog('onSubscriptionUpdated: oldPlan:', oldPlan, 'newPlan:', newPlan, 'isUpgrade:', isUpgrade, 'isDowngrade:', isDowngrade);
  if (!isUpgrade && !isDowngrade) return;

  let customer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    console.error('[stripe-webhook] failed to retrieve customer:', err);
    throw err;
  }
  if ('deleted' in customer) return;

  const email = customer.email ?? undefined;
  const language = customer.metadata?.['language'] as string | undefined;
  const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';

  if (isUpgrade || isDowngrade) {
    try {
      await stripe.customers.update(customerId, {
        metadata: {
          ...(isUpgrade ? { added_to_whatsapp: (customer.phone ? 'false' : 'n/a') satisfies WhatsappStatus, whatsapp_number: customer.phone ?? 'n/a' } : {}),
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
        await sendUpdateFromBasicToStandardEmail(email, lang);
      } else {
        await sendUpdateFromStandardToBasicEmail(email, lang);
      }
    } catch (err) {
      console.error('[stripe-webhook] failed to send plan change email:', err);
    }
  }
}

async function onCustomerUpdated(customer: CustomerUpdated, previousAttributes: CustomerUpdatedData['previous_attributes']) {
  if (!previousAttributes) return;

  const emailChanged = 'email' in previousAttributes && previousAttributes.email != null && previousAttributes.email !== customer.email;
  const phoneChanged = 'phone' in previousAttributes;
  devLog('onCustomerUpdated: customerId:', customer.id, 'emailChanged:', emailChanged, 'phoneChanged:', phoneChanged);
  if (!emailChanged && !phoneChanged) return;

  if (emailChanged && customer.email) {
    const consent = customer.metadata?.['marketing_consent'];
    if (consent === 'true') {
      const language = customer.metadata?.['language'] as string | undefined;
      const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';
      try {
        await Promise.all([
          removeNewsletterContact(previousAttributes.email!),
          addNewsletterContact(customer.email, lang),
        ]);
      } catch (err) {
        console.error('[stripe-webhook] failed to update newsletter contact on email change:', err);
      }
    }
  }

  if (!phoneChanged) return;

  const previousPhone = previousAttributes.phone ?? null;
  const currentPhone = customer.phone ?? null;
  if (!currentPhone || currentPhone === previousPhone) return;

  let subscriptions;
  try {
    subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
  } catch (err) {
    console.error('[stripe-webhook] failed to list subscriptions on customer.updated:', err);
    throw err;
  }

  const sub = subscriptions.data[0];
  if (!sub) return;

  const plan = getPlanFromProductId(sub.items.data[0]?.price.product as string);
  if (plan !== 'standard' && plan !== 'premium') return;

  const language = customer.metadata?.['language'] as string | undefined;
  const lang: Lang = VALID_LANGS.includes(language as Lang) ? language as Lang : 'en';
  const email = customer.email ?? undefined;

  if (!previousPhone) {
    // First-time phone addition via portal — guard against checkout-triggered updates
    const existingWhatsappNumber = customer.metadata?.['whatsapp_number'];
    if (existingWhatsappNumber && existingWhatsappNumber !== 'n/a') return;

    try {
      await stripe.customers.update(customer.id, {
        metadata: {
          added_to_whatsapp: 'false' satisfies WhatsappStatus,
          whatsapp_number: currentPhone,
        },
      });
    } catch (err) {
      console.error('[stripe-webhook] failed to update metadata on first phone addition:', err);
      throw err;
    }

    if (email) {
      try {
        await sendPhoneNumberCompleteEmail(email, lang);
      } catch (err) {
        console.error('[stripe-webhook] failed to send phone number complete email:', err);
      }
    }
  } else {
    // Phone changed — flag for manual review
    try {
      await stripe.customers.update(customer.id, {
        metadata: { whatsapp_number_outdated: 'true' satisfies WhatsappNumberOutdated },
      });
    } catch (err) {
      console.error('[stripe-webhook] failed to set whatsapp_number_outdated:', err);
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

  devLog('stripe-webhook: event type:', event.type);

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
      case 'customer.updated':
        await onCustomerUpdated(event.data.object, event.data.previous_attributes);
        break;
    }
  } catch (err) {
    return res.status(500).end('Internal server error');
  }

  return res.status(200).json({ received: true });
}
