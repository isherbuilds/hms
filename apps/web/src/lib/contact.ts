import { env } from "@hms/env/web";

/* Public contact channels, shared by the contact page and every marketing CTA.
   WhatsApp click-to-chat: digits-only international number, URL-encoded text.
   The prefilled line names the product so a hospital's first message is not
   "hi" and we are not guessing who is asking about what. */
export const WHATSAPP_URL = `https://wa.me/${env.VITE_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Hi, I'd like to see Edernal Care for our hospital.",
)}`;

export const CONTACT_MAILTO = `mailto:${env.VITE_CONTACT_EMAIL}`;

/* One number answers calls and WhatsApp. `VITE_WHATSAPP_NUMBER` is E.164 digits;
   the last ten are the national number people read and dial in India. */
const NATIONAL = env.VITE_WHATSAPP_NUMBER.slice(-10);

export const PHONE_DISPLAY = `${NATIONAL.slice(0, 3)} ${NATIONAL.slice(3, 6)} ${NATIONAL.slice(6)}`;

export const PHONE_TEL = `tel:+${env.VITE_WHATSAPP_NUMBER}`;
