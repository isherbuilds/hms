import { env } from "@hms/env/web";

/* Public contact channels, shared by the contact page and every marketing CTA.
   WhatsApp click-to-chat: digits-only international number, URL-encoded text.
   The prefilled line names the product so a hospital's first message is not
   "hi" and we are not guessing who is asking about what. */
export const WHATSAPP_URL = `https://wa.me/${env.VITE_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Hi, I'd like to see Edernal Care for our hospital.",
)}`;

export const CONTACT_MAILTO = `mailto:${env.VITE_CONTACT_EMAIL}`;

/* Keep the display faithful to every E.164 number accepted by configuration. */
export const PHONE_DISPLAY = `+${env.VITE_WHATSAPP_NUMBER}`;

export const PHONE_TEL = `tel:+${env.VITE_WHATSAPP_NUMBER}`;
