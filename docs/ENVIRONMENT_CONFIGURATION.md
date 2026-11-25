# Environment Configuration & Infrastructure Inventory

**Project:** Enterprise AI-First Email Marketing, Delegate Acquisition & Omnichannel Event Automation Platform  
**Target Events:** GIPC 2027 (4–5 Feb 2027) & CPVA Certification (8–10 Feb 2027)  
**Date:** 25 November 2026  

---

## 1. Master Environment Variable Inventory

| Variable Name | Required By | Description / Current Status | Secret? |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | Core Platform | MongoDB Atlas connection string (`<MONGODB_URI>`) | Yes (Configured) |
| `BETTER_AUTH_SECRET` | Authentication | Cryptographic signing secret for user sessions & links | Yes (Configured) |
| `SUPPRESSION_HASH_KEY`| Deliverability | Cryptographic hash key for global suppression tables | Yes (Configured) |
| `APP_URL` | Application URL | Base public URL (`https://mailchimp-peach.vercel.app` / `http://localhost:3000`) | No |
| `ADMIN_EMAILS` | Auth & Access | Comma-separated admin emails (`admin@globalipconvention.com`) | No (Configured) |
| `EMAIL_FROM` | Deliverability | Default platform sender (`updates@updates.globalipconvention.com`) | No |
| `SENDING_ENABLED` | Core Platform | Global kill switch for campaign sends (`true` / `false`) | No |
| `EMAIL_PROVIDER` | Core Platform | Email backend selector (`ses`) | No |
| `SES_REGION` | Amazon SES | AWS region with verified production access (`ap-south-1`) | No |
| `SES_ACCESS_KEY_ID` | Amazon SES | AWS IAM User access key ID (`<CONFIGURED_IN_ENV>`) | Yes |
| `SES_SECRET_ACCESS_KEY` | Amazon SES | AWS IAM User secret access key | Yes |
| `SES_AWS_ACCOUNT_ID` | Amazon SES | 12-digit AWS Account ID (`132873435443`) | No |
| `SES_SNS_TOPIC_ARN` | Amazon SES | SNS Topic ARN for automated bounce/complaint webhooks | No (Pending SNS setup) |
| `QSTASH_TOKEN` | Upstash QStash | QStash API bearer token for async background queues | Yes (Required for bulk) |
| `QSTASH_CURRENT_SIGNING_KEY`| QStash | Webhook signature key for verifying incoming job dispatches | Yes |
| `QSTASH_NEXT_SIGNING_KEY`| QStash | Secondary key for QStash webhook rotation | Yes |
| `UPSTASH_REDIS_REST_URL`| Distributed Rate Limit | Redis REST URL for multi-instance send throttling | Yes (Optional) |
| `UPSTASH_REDIS_REST_TOKEN`| Distributed Rate Limit | Redis REST authentication token | Yes (Optional) |
| `WHATSAPP_PHONE_NUMBER_ID`| WhatsApp Cloud API | Meta Phone Number ID for GIPC/CPVA official sender | Yes (Pending Client) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API | Meta Permanent System User Access Token | Yes (Pending Client) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`| WhatsApp | Meta WABA ID for template synchronization | Yes (Pending Client) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`| WhatsApp | Custom secret for Meta webhook handshake verification | Yes |
| `PAYMENT_WEBHOOK_SECRET`| Payment Gateway | Secret for verifying incoming payment gateway signatures | Yes (Pending Gateway) |
| `AI_PROVIDER_API_KEY` | Marketing Co-Pilot | API key for OpenAI GPT-4o / Anthropic Claude / Gemini API | Yes (Pending Client) |

---

## 2. External Services Status & Connectivity Summary

### A. Amazon SES (`ap-south-1`) — VERIFIED WORKING
- **Account ID:** `132873435443`
- **IAM User:** `arn:aws:iam::132873435443:user/JAY`
- **Daily Quota:** 50,000 emails / 24 hours
- **Rate Limit:** 14 emails / second
- **Verified Identities:**
  - `updates.globalipconvention.com` (DKIM 2048-bit Verified)
  - `events.globalipconvention.com` (Verified)
  - `reply@globalipconvention.com` (Verified)
- **Live Dispatch Status:** Confirmed operational with test message ID `010901a212d722f3-548def4b-f5ce-4c75-a315-9d30c62bb726-000000`.

### B. MongoDB Atlas — VERIFIED WORKING
- **Cluster:** Dedicated MongoDB Atlas Cluster
- **Database:** `mailcheap`
- **Network Access:** Whitelist entry `0.0.0.0/0` active.
- **Connection Mode:** Mongoose with connection pooling and serverless keep-alive.

### C. Vercel Hosting — VERIFIED WORKING
- **Project:** `mailchimp`
- **Domain:** `https://mailchimp-peach.vercel.app`
- **Framework:** Next.js 16.4.1 App Router

### D. Upstash QStash & Redis — SETUP REQUIRED FOR BULK
- For single test emails and low-volume sends, direct synchronous SES delivery operates cleanly.
- For high-volume sending (10,000 to 50,000 per day across 1,50,000 contacts), Upstash QStash queues are required to avoid Vercel serverless function timeouts.

### E. WhatsApp Business Cloud API — PENDING ONBOARDING
- Requires Meta for Developers App registration + WhatsApp Business Account (WABA).
- Requires pre-approval of the 6 utility message templates by Meta.

### F. Payment Gateway Webhook — PENDING ONBOARDING
- Target provider (Razorpay, Stripe, Eventbrite, or custom checkout) must be designated to configure webhook signatures.
