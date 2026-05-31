# XRP Roofing CRM Independent Deployment Guide

## Goal

Deploy this CRM as a completely separate GitHub repository and separate Vercel project from the public website.

The public website repository and production deployment should remain unchanged.

## Repository name

Recommended GitHub repository name:

```text
xrp-roofing-crm
```

## Local repository setup

Run these commands from inside the standalone CRM folder:

```bash
git init
git branch -M main
git add .
git commit -m "Initial standalone CRM migration"
```

Create a new empty GitHub repository named `xrp-roofing-crm`, then connect it:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/xrp-roofing-crm.git
git push -u origin main
```

Do not add this CRM project as a remote for the existing website repository.

## Local validation

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Run production build:

```bash
npm run build
```

## Required environment variables

### Supabase auth

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Supabase server-side invoice/proposal sharing and webhook sync

```text
SUPABASE_SERVICE_ROLE_KEY
```

### Email sending

```text
RESEND_API_KEY
```

### Stripe checkout and payment support

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

### Google Maps autocomplete

```text
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
```

### Twilio conversations, SMS, and voice

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

## Vercel deployment steps

1. Go to Vercel and create a new project.
2. Import the new GitHub repository:

```text
xrp-roofing-crm
```

3. Confirm framework preset:

```text
Next.js
```

4. Use default build settings:

```text
Install Command: npm install
Build Command: npm run build
Output Directory: default
```

5. Add the environment variables listed above to the new CRM Vercel project.
6. Deploy.

## Supabase setup for separate CRM domain

The CRM can use the same Supabase project safely, but the new CRM domain must be added to Supabase Auth settings.

Add redirect URLs like:

```text
https://your-vercel-crm-domain.vercel.app/crm
https://your-vercel-crm-domain.vercel.app/reset-password
https://crm.xrproofing.com/crm
https://crm.xrproofing.com/reset-password
```

If using local development, also allow:

```text
http://localhost:3000/crm
http://localhost:3000/reset-password
```

## Stripe setup

Add this webhook endpoint in Stripe after the CRM domain exists:

```text
https://your-crm-domain.com/api/stripe/webhook
```

Recommended production subdomain endpoint later:

```text
https://crm.xrproofing.com/api/stripe/webhook
```

## Twilio setup

Use the new CRM deployment domain for Twilio webhooks:

```text
https://your-crm-domain.com/api/twilio/webhooks/incoming-sms
https://your-crm-domain.com/api/twilio/webhooks/message-status
https://your-crm-domain.com/api/twilio/webhooks/incoming-call
https://your-crm-domain.com/api/twilio/webhooks/call-status
https://your-crm-domain.com/api/twilio/voice/twiml
```

Recommended production subdomain later:

```text
crm.xrproofing.com
```

## Recommended DNS setup later

Create a DNS record for:

```text
crm.xrproofing.com
```

Point it to Vercel according to Vercel's domain instructions.

Common Vercel DNS options:

```text
CNAME crm cname.vercel-dns.com
```

or follow the exact DNS value Vercel gives for the project.

## Route verification checklist

After deployment, verify:

```text
/login
/signup
/forgot-password
/reset-password
/crm
/crm/invoices
/crm/payments
/crm/settings
/api/auth/login
/api/stripe/checkout
/api/stripe/webhook
```

## Safety checklist

- Do not push this project to the existing website GitHub repository.
- Do not change the existing website Vercel project.
- Do not change the existing website root deployment settings.
- Keep environment variables separate in the CRM Vercel project.
- Use Supabase redirect URLs for both the existing website CRM and the new CRM domain during transition.
