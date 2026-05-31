# Standalone CRM Migration Report

## Status

The CRM was cloned into a new standalone project at `crm-standalone`.

This was completed as a non-destructive migration clone:

- No existing website files were deleted.
- No existing website routes were moved.
- No existing CRM routes were moved.
- No existing production deployment settings were modified.
- The original combined website + CRM project remains intact.

## New project path

```text
crm-standalone/
```

## CRM routes copied

```text
app/crm/page.tsx
app/crm/layout.tsx
app/crm/calendar/page.tsx
app/crm/conversations/page.tsx
app/crm/customers/page.tsx
app/crm/estimates/page.tsx
app/crm/files/page.tsx
app/crm/invoices/page.tsx
app/crm/leads/page.tsx
app/crm/payments/page.tsx
app/crm/pdf-signer-board/page.tsx
app/crm/proposals/page.tsx
app/crm/settings/page.tsx
app/crm/tasks/page.tsx
```

## Auth pages copied

```text
app/login/page.tsx
app/signup/page.tsx
app/forgot-password/page.tsx
app/reset-password/page.tsx
```

## API routes copied

```text
app/api/auth/login/route.ts
app/api/invoices/send/route.ts
app/api/invoices/share/route.ts
app/api/proposals/send/route.ts
app/api/proposals/share/route.ts
app/api/stripe/checkout/route.ts
app/api/stripe/webhook/route.ts
app/api/twilio/notes/route.ts
app/api/twilio/sms/send/route.ts
app/api/twilio/voice/call/route.ts
app/api/twilio/voice/token/route.ts
app/api/twilio/voice/twiml/route.ts
app/api/twilio/webhooks/call-status/route.ts
app/api/twilio/webhooks/incoming-call/route.ts
app/api/twilio/webhooks/incoming-sms/route.ts
app/api/twilio/webhooks/message-status/route.ts
```

## CRM components copied

```text
components/crm/AuthForm.tsx
components/crm/CrmShell.tsx
components/crm/conversations/ConversationBoard.tsx
```

## CRM libraries copied

```text
lib/crm-data.ts
lib/crm-conversations.ts
lib/sms-compliance.ts
lib/utils.ts
lib/supabase/client.ts
lib/supabase/server.ts
lib/supabase/url.ts
lib/twilio/client.ts
lib/twilio/config.ts
lib/twilio/realtime.ts
lib/twilio/server.ts
```

## Types copied

```text
types/crm.ts
types/conversations.ts
types/twilio-conversations.ts
```

## Standalone-only files added

```text
app/layout.tsx
app/page.tsx
app/globals.css
package.json
package-lock.json
next.config.ts
postcss.config.mjs
eslint.config.mjs
tsconfig.json
middleware.ts
components.json
.env.example
vercel.json
README.md
MIGRATION_REPORT.md
```

## Public website files intentionally excluded

The standalone CRM does not include public website marketing pages, SEO pages, service pages, blog routes, website layout chrome, marketing UI components, sitemap, robots, or existing website deployment configuration.

Examples intentionally excluded:

```text
app/page.tsx from the website
app/about
app/blog
app/contact
app/services
app/locations
components/layout
components/ui marketing sections
lib/contentEngine.ts
lib/services.ts
lib/cities.ts
netlify.toml
existing root vercel.json
```

## Required environment variables

Minimum required for Supabase auth:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Required for Supabase-backed invoice/proposal sharing and payment sync:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Required for invoice/proposal emails:

```text
RESEND_API_KEY
```

Required for Stripe checkout:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Required for Google Maps autocomplete in CRM lead/proposal forms:

```text
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
```

Required for Twilio conversations, SMS, and voice:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_TWIML_APP_SID
TWILIO_PHONE_NUMBER
TWILIO_MESSAGE_STATUS_WEBHOOK_URL
TWILIO_OUTBOUND_VOICE_WEBHOOK_URL
TWILIO_CALL_STATUS_WEBHOOK_URL
```

## Deployment instructions

1. Create a new Vercel project.
2. Set the project root directory to:

```text
crm-standalone
```

3. Use the default Next.js build settings:

```text
Install command: npm install
Build command: npm run build
Output directory: default
```

4. Add all required environment variables in the new Vercel project.
5. Deploy the new Vercel project independently from the website deployment.
6. Configure Supabase Auth redirect URLs for the new CRM domain:

```text
https://your-crm-domain.com/crm
https://your-crm-domain.com/reset-password
```

7. Configure Stripe webhook endpoint for the new CRM domain:

```text
https://your-crm-domain.com/api/stripe/webhook
```

8. Configure Twilio webhook URLs for the new CRM domain if Twilio features are used.

## Validation performed

The standalone CRM dependency install completed successfully in `crm-standalone`.

The standalone production build completed successfully:

```text
npm run build
```

Build result:

```text
Compiled successfully
Finished TypeScript
Generated all standalone CRM routes
```

## Manual follow-ups

- Review `npm audit` output. The install reported 2 vulnerabilities from dependencies.
- Decide whether to keep the copied `middleware.ts` convention or later migrate it to Next.js `proxy` because Next.js reports `middleware` as deprecated.
- Confirm production Supabase redirect URLs before deploying.
- Confirm Stripe webhook signature validation if strict Stripe webhook verification is required in production.
- Confirm Twilio webhook URLs after the standalone CRM domain is assigned.
