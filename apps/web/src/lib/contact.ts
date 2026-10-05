import { env } from "@hms/env/web";

/* D062: one founder-owned public inbox; phone and WhatsApp appear only when configured. */
export const CONTACT_EMAIL = "support@edernal.com";

export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

export const CONTACT_RESPONSE =
  "The founder handles this inbox, acknowledges messages within 48 hours and resolves grievances within one month.";

const phoneNumber = env.VITE_WHATSAPP_NUMBER;

export const PHONE = phoneNumber
  ? {
      display: `+${phoneNumber}`,
      tel: `tel:+${phoneNumber}`,
      whatsapp: `https://wa.me/${phoneNumber}?text=${encodeURIComponent(
        "Hi, I'd like to see Edernal Care for our hospital.",
      )}`,
    }
  : null;
