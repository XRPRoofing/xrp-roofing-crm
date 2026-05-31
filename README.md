# XRP Roofing CRM Standalone

This folder is a non-destructive standalone clone of the CRM from the existing XRP Roofing Next.js repository.

The original website and original CRM files remain in place. This project is intended to be deployed independently.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and the app redirects to `/crm`.

## Required environment variables

See `.env.example` for the full list.

Minimum required for auth:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Recommended for server-side invoice/proposal sharing and payment sync:

```bash
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Optional integrations:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_PHONE_NUMBER=
TWILIO_MESSAGE_STATUS_WEBHOOK_URL=
TWILIO_OUTBOUND_VOICE_WEBHOOK_URL=
TWILIO_CALL_STATUS_WEBHOOK_URL=
```

## Vercel deployment

Deploy this folder as its own Vercel project with `crm-standalone` as the root directory.

Build command:

```bash
npm run build
```

Output directory: leave default for Next.js.

## Notes

- Public website routes, SEO pages, service pages, blogs, and marketing components are intentionally not included.
- The standalone root page redirects to `/crm`.
- Auth pages remain at `/login`, `/signup`, `/forgot-password`, and `/reset-password`.
- CRM pages remain under `/crm`.
