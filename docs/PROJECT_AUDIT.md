# Project Architecture & Infrastructure Audit

**Project:** Enterprise AI-First Email Marketing, Delegate Acquisition & Omnichannel Event Automation Platform  
**Target Events:**  
- **Event 1:** 20th Global Intellectual Property Convention (GIPC 2027) — 4–5 February 2027 (T-Hub, Hyderabad)  
- **Event 2:** Certified Patent Valuation Analyst (CPVA) 3-Day Certification — 8–10 February 2027 (Hyderabad)  
**Execution Horizon:** 23 November 2026 – 12 February 2027  
**Auditor:** Senior Principal Architect & Systems Engineer  
**Date of Audit:** 25 November 2026  

---

## 1. Executive Summary & Codebase Architecture

The application is built upon **MailCheap**, an open-source (AGPL-3.0) newsletter and email platform structured with **Next.js 16.4.1 (App Router)**, **Turbopack**, **Tailwind CSS v4**, **Mongoose / MongoDB**, and **Better Auth v1.7.17**.

### Current Repository Inventory & Structure
- **Core Framework:** Next.js 16.4.1 with Node.js 22 runtime.
- **Data Layer:** MongoDB via Mongoose (ODM). Connected to MongoDB Atlas cluster.
- **Auth Layer:** Better Auth (`@better-auth/cimd`, `@better-auth/oauth-provider`, `emailOTP`, `jwt`). Supports passwordless OTP, Google OAuth, and Model Context Protocol (MCP) authentication.
- **Email Delivery Core:** Modular provider abstraction (`lib/email-provider/index.js`) switching between Amazon SES (`lib/email-provider/ses.js`, `@aws-sdk/client-sesv2`) and PostShiba. MailCheap platform transactional emails run via `lib/platform-email.js`.
- **Background Jobs & Scheduling:** QStash integration (`@upstash/qstash`) for queued batch sending, scheduled jobs, bounce backoff, and hourly crons (`app/api/jobs/*`, `app/api/cron/*`).
- **UI Architecture:** Server components by default, Radix UI primitives, TipTap rich text email editor, lucide-react icons, and custom responsive layouts.
- **REST & MCP API:** Action-driven architecture (`defineAction` in `lib/actions/*`, evaluated via `runAction`), exposing a unified REST API (`app/api/v1/[...path]`) and MCP server (`/mcp`, `app/api/mcp`).

---

## 2. AWS SES Infrastructure & Identity Audit

A live audit was conducted using the provided AWS credentials (`<CONFIGURED_IN_ENV>`):

### A. AWS Account & Identity Resolution
- **AWS Account ID:** `132873435443`
- **IAM User ARN:** `arn:aws:iam::132873435443:user/JAY`
- **Primary Production SES Region:** `ap-south-1` (Mumbai)

### B. Production Sending Status & Quotas
| Metric | Real-World Value | Verification Status |
| :--- | :--- | :--- |
| **SES Region** | `ap-south-1` | Verified Active |
| **Production Access** | **Enabled** (`ProductionAccessEnabled: true`) | Verified |
| **Account Health Status** | **HEALTHY** (`EnforcementStatus: HEALTHY`) | Verified |
| **Daily Sending Quota** | **50,000 emails / 24 hours** | Verified |
| **Max Send Rate** | **14 emails / second** (840 emails/min) | Verified |
| **Sent Last 24 Hours** | Active | Verified |
| **Case Review Status** | **GRANTED** (Case ID: `179550614600258`) | Verified |
| **Associated Website** | `https://globalipconvention.com/` | Verified |
| **Virtual Deliverability Manager (VDM)** | Enabled (Engagement metrics + OptimizedSharedDelivery) | Verified |

### C. Email Identities & DNS Verification (`ap-south-1`)
1. **`updates.globalipconvention.com`**
   - Type: `DOMAIN`
   - Verification Status: `SUCCESS`
   - Sending Status: `Enabled: true`
   - DKIM: `RSA_2048_BIT`, Status: `SUCCESS` (3 CNAME tokens active)
   - Configuration Set: Associated with `my-first-configuration-set`
   - **Live Send Test:** **Passed**. A live test message was successfully dispatched via SESv2 (`MessageId: 010901a212d722f3-548def4b-f5ce-4c75-a315-9d30c62bb726-000000`) and delivered.
2. **`events.globalipconvention.com`**
   - Type: `DOMAIN`
   - Verification Status: `SUCCESS`
   - Sending Status: `Enabled: true`
3. **`reply@globalipconvention.com`**
   - Type: `EMAIL_ADDRESS`
   - Verification Status: `SUCCESS`
4. **`aarhat.tech@gmail.com`**
   - Type: `EMAIL_ADDRESS`
   - Verification Status: `SUCCESS`

### D. Dedicated IP & Warm-Up Assessment
- **Dedicated IPs Assigned:** `[]` (**None provisioned**).
- **Current Mode:** Standard AWS SES Shared IP pool with Virtual Deliverability Manager (VDM) Optimized Shared Delivery enabled.
- **Finding:** The agreement specifies a "Dedicated Sending IP + progressive 14-day domain/IP warm-up". Currently, the AWS account has auto-warmup flag enabled, but zero dedicated IPs leased. Leased dedicated IPs on Amazon SES cost \$24.95/month per IP.

### E. IAM Permission Assessment
- The IAM user `JAY` has full SES v2 API permissions.
- **Limitation Identified:** Querying `SNS:ListTopics` returned an `AuthorizationError` (`User is not authorized to perform: SNS:ListTopics`). For automated bounce/complaint webhook processing via Amazon SNS, the IAM user must have SNS topic management and subscription permissions.

---

## 3. Vercel Deployment & Environment Audit

- **Vercel Project:** `mailchimp`
- **Vercel Team:** `raj-kumars-projects-d038f16e`
- **Connected GitHub Repo:** `https://github.com/jayaditya5166/mailcheap`
- **Production URL:** `https://mailchimp-peach.vercel.app`
- **Sign-in URL:** `https://mailchimp-peach.vercel.app/signin`
- **Health Check Endpoint:** `https://mailchimp-peach.vercel.app/api/health` -> `{"ok":true}`
- **Database Connection:** Connected to MongoDB Atlas (`mailcheap`). Network access (`0.0.0.0/0`) verified.

---

## 4. Comprehensive Architectural Breakdown (Sections A – J)

### A. Existing Functionality
1. **Contact Storage & Base Filtering:** Single-newsletter subscriber tracking with basic tags, status (`subscribed`, `unsubscribed`, `bounced`, `complained`), and simple CSV import.
2. **Campaign Editor & Composer:** Markdown / TipTap HTML editor with preview, send-time scheduling, and test email delivery.
3. **SES Integration:** SES v2 client with basic sending routines, domain identity lookup, and multitenant configuration set stubs.
4. **Tracking System:** Open tracking pixels (`app/o/[token]`), click redirection and link tracking (`app/c/[token]`), and one-click unsubscribe (`app/unsubscribe`).
5. **Suppression Mechanism:** Global suppression hashes (`GlobalSuppression.js`) for permanent spam traps and 180-day bounce memory.
6. **Background Task Handling:** Upstash QStash webhook receiver for batching and cron jobs.

### B. Existing Functionality Reusable Without Modification
- Open & click link tracking redirects (`app/o/[token]`, `app/c/[token]`).
- Better Auth session middleware and account scoping (`scoped()`).
- Health check endpoint (`app/api/health`).
- SVG / Media upload handlers (`app/api/uploads`).
- Cryptographic link token generation and verification (`lib/contact-token.js`, `lib/campaign-links.js`).

### C. Existing Functionality Requiring Modification
1. **`models/Contact.js` & `lib/contacts.js`:** Currently designed for simple newsletter subscribers. Must be extended to support enterprise event contact schemas: designation, company, industry, GIPC registration status, CPVA status, attendee type, behavioural score, VIP flags, and rich segmentation tags.
2. **`lib/contact-import.js` & `lib/csv-import.js`:** Designed for small newsletter lists. Must be upgraded for **1,50,000 contacts** using chunked streaming, bulk `bulkWrite` operations, and custom field mapping.
3. **`lib/email-provider/ses.js` & `lib/ses.js`:** Defaults to region `us-east-1` and multitenant tenant models. Must be adjusted to default to `ap-south-1`, use verified configuration sets (`my-first-configuration-set` / GIPC config set), and enforce the 25,00,000 project send cap.
4. **Navigation & Dashboard (`components/NavApp.jsx`, `app/(app)/*`):** Currently displays newsletter tabs. Must be upgraded to the 16-module enterprise event structure specified in Section 3 of the prompt.
5. **Campaign Engine (`models/Campaign.js`):** Needs support for multi-track event targeting (GIPC Track A vs. CPVA Track B), dynamic suppression of paid delegates, and automated drip sequences.

### D. Missing Functionality Requiring New Development
1. **Module 3: 14-Day IP & Domain Warm-Up Scheduler:** Daily and hourly volume caps, domain-level throttling (Gmail, Microsoft 365, Corporate Exchange).
2. **Module 4: AI Marketing Co-Pilot:** LLM integration (OpenAI / Anthropic / Gemini) for copy generation, persona tailoring, subject line A/B variants, and MJML responsive template generation.
3. **Module 5: AI Persona Segmentation Engine:** Automatic classification into In-House Counsel, IP Law Firm, Startup/R&D, and CPVA High-Intent leads.
4. **Module 6: GIPC 12-Touchpoint Campaign Engine:** Pre-configured sequence covering Save the Date, Keynote Reveals, Agenda, and Urgency waves.
5. **Module 7: Behavioural Retargeting Engine:** Intent tagging based on link click categories (Speaker vs. Pricing vs. Agenda vs. CPVA).
6. **Module 8: Registration & Payment Gateway Webhook Manager:** Webhook ingestion with HMAC signature verification, idempotency logging, transaction recording, and instant contact status updates.
7. **Module 9: WhatsApp Business Platform Concierge:** WhatsApp Cloud API integration for the 6 post-signup automated delegate touchpoints.
8. **Module 10 & 11: CPVA 25-Seat Live Scarcity & Management:** Atomic seat locking, real-time remaining seat counter, cross-sell triggers, and scarcity email alerts.
9. **Module 12: Automated Document Generation:** High-resolution PDF generation for Invoices, Corporate Justification Letters, Calendar Invites, and Certificates.
10. **Module 13: QR Badge Management:** Secure signed QR tokens, badge PDF generation, WhatsApp delivery, and check-in scanner validation endpoint.
11. **Module 14 & 15: Analytics, Attribution & Post-Event Closure:** ROI metrics, CPA tracking, funnel drop-off reports, and post-event export packages.

### E. Third-Party Integrations Required
- **Amazon SES (Active):** Region `ap-south-1`, 50k/day quota.
- **Amazon SNS:** For bounce and complaint webhook ingestion.
- **Upstash QStash & Redis:** For queueing 50k/day sending and distributed rate-limiting.
- **WhatsApp Business Cloud API (Meta Graph API):** For transactional concierge utility messages.
- **Payment Gateway / Registration Webhooks:** (Razorpay, Stripe, Eventbrite, or custom form webhook).
- **AI Model Provider:** (OpenAI GPT-4o / Anthropic Claude / Google Gemini API) for marketing co-pilot.

### F. Environment Variables Required
*(Documented in detail in `docs/ENVIRONMENT_CONFIGURATION.md`)*.

### G. Database Schema Changes Required
*(Documented in detail in `docs/FEATURE_GAP_ANALYSIS.md`)*. New schemas required for `EventRegistration`, `PaymentTransaction`, `CPVASeat`, `WhatsAppMessage`, `EventDocument`, `QRBadge`, and `BehaviouralEvent`.

### H. Security Vulnerabilities & Configuration Risks
- **Rate-Limiting on Webhooks:** Payment webhooks must be protected against replay attacks using idempotency keys and signature verification.
- **QR Code Security:** Must use HMAC-signed payload tokens so QR badges cannot be forged or guessed.
- **Document Access:** Invoices and certificates must be accessible only via signed temporary URLs or authenticated routes.
- **AWS Credentials:** Never expose AWS credentials in client-side code; maintain all operations in server-only modules (`import "server-only"`).

### I. Potential Performance Bottlenecks
- **1,50,000 Contact CSV Import:** Standard synchronous JSON parsing will crash Node.js heap memory. Must stream CSV records in batches of 1,000 using `mongo.bulkWrite(ordered: false)`.
- **SES Max Send Rate:** 14 emails/second equals ~50,400 emails/hour max theoretical rate. QStash dispatchers must throttle delivery to 10–12 emails/sec to prevent SES `454 Throttling` exceptions.
- **Vercel Execution Timeout:** Vercel Hobby serverless functions timeout at 10–15s (Pro at 60–300s). Heavy document generation (PDFs) and batch processing must be dispatched asynchronously via background worker endpoints.

### J. Deployment & Compatibility Risks
- **Next.js 16.4.1 Security Advisory:** npm advisory flagged on Next.js 16.4.1. An upgrade to 16.4.2+ should be performed in a dedicated branch once core modules are staged.
- **DNS Propagation:** Custom MAIL FROM domain (`bounce.updates.globalipconvention.com`) requires MX and TXT SPF records for 100% DMARC alignment.
