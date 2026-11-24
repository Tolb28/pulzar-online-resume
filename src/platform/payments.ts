import { timingSafeEqual } from './crypto';

// Payments (A5): the provider is a platform decision, so it sits behind an interface.
// "dev" pays instantly on a test page; "stripe" uses Checkout in CZK.

export interface CheckoutInput {
  paymentId: string;
  amountCzk: number;
  description: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookResult {
  paymentId: string;
  ref: string;
  paid: boolean;
}

export interface PaymentProvider {
  id: string;
  createCheckout(input: CheckoutInput): Promise<{ url: string; ref: string }>;
  /** Verify and read a provider webhook; null when it is not for us or not valid. */
  parseWebhook(req: Request): Promise<WebhookResult | null>;
}

export class DevPayments implements PaymentProvider {
  id = 'dev';
  async createCheckout(input: CheckoutInput) {
    return { url: `/ucet/platba/test/${input.paymentId}`, ref: `dev_${input.paymentId}` };
  }
  async parseWebhook(): Promise<WebhookResult | null> {
    return null;
  }
}

export class StripePayments implements PaymentProvider {
  id = 'stripe';
  constructor(
    private secretKey: string,
    private webhookSecret: string,
    private now: () => number = Date.now,
  ) {}

  async createCheckout(input: CheckoutInput) {
    const form = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'czk',
      'line_items[0][price_data][unit_amount]': String(input.amountCzk * 100),
      'line_items[0][price_data][product_data][name]': input.description,
      customer_email: input.email,
      client_reference_id: input.paymentId,
      'metadata[payment_id]': input.paymentId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'cs',
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const j = (await r.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!r.ok || !j.url || !j.id) throw new Error(`Stripe checkout failed: ${j.error?.message ?? r.status}`);
    return { url: j.url, ref: j.id };
  }

  async parseWebhook(req: Request): Promise<WebhookResult | null> {
    const header = req.headers.get('stripe-signature') ?? '';
    const raw = await req.text();
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || !parts.v1 || Math.abs(this.now() / 1000 - t) > 300) return null;
    const expected = await hmacHex(this.webhookSecret, `${t}.${raw}`);
    if (!timingSafeEqual(expected, parts.v1)) return null;
    const event = JSON.parse(raw) as { type: string; data: { object: { id: string; payment_status?: string; metadata?: { payment_id?: string } } } };
    if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return null;
    const s = event.data.object;
    if (!s.metadata?.payment_id) return null;
    return { paymentId: s.metadata.payment_id, ref: s.id, paid: s.payment_status === 'paid' };
  }
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
