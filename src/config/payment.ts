/**
 * Centralized UPI Payment Configuration
 *
 * Update these values in ONE place to change payment details across the entire application.
 * The QR code image should be placed at: public/assets/upi-qr.jpg
 */

export const PAYMENT_CONFIG = {
  /** The UPI VPA (Virtual Payment Address) to receive payments */
  upiId: 'q462939567@ybl',

  /** Display name for the payee shown in UPI payment apps */
  payeeName: 'PhonePe Recharge',

  /** Path to the uploaded UPI QR code image (relative to public/) */
  qrCodePath: '/assets/upi-qr.jpg',

  /**
   * Whether the QR code is static (amount not embedded) or dynamic.
   * Static QR: customer must verify/enter the amount in their payment app.
   * Set to true only if the QR contains a fixed amount encoded.
   */
  isQrDynamic: false,

  /** Merchant category code (optional, for UPI URI) */
  merchantCode: '',

  /** Currency code */
  currency: 'INR',
} as const;

/**
 * Generate a standard UPI payment URI.
 * Compatible with PhonePe, Paytm, Google Pay, and other BHIM-UPI apps.
 *
 * @see https://www.npci.org.in/what-we-do/upi/upi-qr-code
 */
export function generateUPIUri(params: {
  amount: number;
  orderId: string;
  note?: string;
  upiId?: string;
}): string {
  const { amount, orderId, note, upiId } = params;

  const upiParams = new URLSearchParams({
    pa: upiId || PAYMENT_CONFIG.upiId,
    pn: PAYMENT_CONFIG.payeeName,
    am: amount.toFixed(2),
    cu: PAYMENT_CONFIG.currency,
    tn: note || `Recharge Order ${orderId}`,
    tr: orderId,
  });

  if (PAYMENT_CONFIG.merchantCode) {
    upiParams.set('mc', PAYMENT_CONFIG.merchantCode);
  }

  return `upi://pay?${upiParams.toString()}`;
}

/**
 * Generate a deep link for specific payment apps.
 * Falls back to generic upi:// if app-specific routing is unsupported.
 */
export function generateAppDeepLink(
  app: 'phonepe' | 'paytm' | 'gpay' | 'generic',
  params: { amount: number; orderId: string; note?: string; upiId?: string }
): string {
  const baseUri = generateUPIUri(params);

  // Some apps register custom schemes; however, the standard upi:// scheme
  // is universally supported and lets the OS/browser route to the installed app.
  // Using app-specific schemes may fail if the app isn't installed.
  switch (app) {
    case 'phonepe':
      // PhonePe supports standard upi:// links on Android; on iOS it uses phonepe://
      return baseUri;
    case 'paytm':
      // Paytm supports standard upi:// links
      return baseUri;
    case 'gpay':
      // Google Pay supports standard upi:// links
      return baseUri;
    default:
      return baseUri;
  }
}

/** Generate a unique order reference ID */
export function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}
