# Feature Gap Analysis & Traceability Matrix

**Project:** Enterprise AI-First Email Marketing, Delegate Acquisition & Omnichannel Event Automation Platform  
**Target Events:** GIPC 2027 (4–5 Feb 2027) & CPVA Certification (8–10 Feb 2027)  
**Contract Baseline:** Quotation & Execution Roadmap (Aarhat iServ LLP)  
**Review Date:** 25 November 2026  

---

## Master Feature Matrix (All 15 Modules)

| Module | Required Functionality | Contract Scope Reference | Existing MailCheap Status | Target Implementation Strategy | Implementation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Enterprise Contact Database** | 1,50,000 Contact Capacity | Section 1, 2.1 | Verified with streaming parser & bulkWrite | Constant memory (< 215MB RSS), tested at 3,089 rec/sec | **Implemented & Verified** |
| | CSV Hygiene & Syntax Filtering | Section 3.A | Yes (`lib/domain-lists.js`, `mail-domains.js`) | Reusable; enhanced with role, typo & syntax detection | **Implemented & Verified** |
| | Disposable & Spam-Trap Purging | Section 3.A | Yes (`lib/disposable-domains.js`) | Integrated enterprise domain lists & suppression | **Implemented & Verified** |
| | Event-Specific Contact Fields | Section 4.B, 4.C | Extended (`models/Contact.js`) | Added company, designation, industry, city, phone, persona, GIPC/CPVA status | **Implemented & Verified** |
| | Centralized Suppression Sync | Section 3.A | Yes (`models/Suppression.js`) | Preserves unsubscribes & bounces across all CSV imports | **Implemented & Verified** |
| **2. AWS SES Email Infrastructure** | Production Quota Verification | Section 2.1 | Configured (`lib/ses.js`) | Verified: Region `ap-south-1`, 50,000/day, 14/sec | **Implemented & Verified** |
| | 25,00,000 Lifecycle Send Cap | Section 2.1 | Missing | Add project-level lifecycle quota enforcement | **Not Implemented** |
| | Sending Rate & Queue Throttling | Section 3.A | Basic QStash send batch | Enforce 10–12 sends/sec via token bucket / QStash | **Partially Implemented** |
| | Domain Authentication (SPF/DKIM/DMARC) | Section 2.1 | Verified on AWS | `updates.globalipconvention.com` DKIM verified | **Implemented & Verified** |
| | SNS Bounce & Complaint Webhooks | Section 3.A | Route exists (`/api/webhooks/ses`) | Grant SNS IAM permissions, subscribe topic | **Requires External Config** |
| **3. Dedicated IP & Warm-Up** | Dedicated IP Provisioning | Section 2.1 | 0 Dedicated IPs on AWS | Using VDM Optimized Shared pool; lease dedicated IP if requested | **Requires External Config** |
| | 14-Day Progressive Warm-up Schedule | Section 4 (Week 1–2) | Missing | Build Warm-Up throttler (Day 1: 2k, Day 2: 5k, etc.) | **Not Implemented** |
| | Corporate Domain Throttler | Section 3.A | Partial (Gmail backoff exists) | Add specific throttles for TCS, HUL, Philips, M365 | **Partially Implemented** |
| **4. AI Marketing Co-Pilot** | AI Copy & Subject Line Generator | Section 3.A | Missing | Build AI prompt templates for GIPC & CPVA | **Not Implemented** |
| | Dynamic A/B Subject Lines | Section 3.A | Missing | Add subject A/B split logic in campaign composer | **Not Implemented** |
| | MJML / Responsive Email Builder | Section 3.A | TipTap HTML only | Add responsive corporate layout templates | **Not Implemented** |
| | Brand Twin (GIPC Colors & Assets) | Section 3.A | Missing | Ingest GIPC logos, fonts, colors into presets | **Not Implemented** |
| **5. AI Persona Segmentation** | In-House IP Counsels & IP Heads | Section 3.B.1 | Missing | Keyword & designation classifier rules | **Not Implemented** |
| | Law Firms & Patent Attorneys | Section 3.B.2 | Missing | Domain & firm classifier rules | **Not Implemented** |
| | Startups, Innovators & R&D | Section 3.B.3 | Missing | Deep-tech & incubator segment logic | **Not Implemented** |
| | CPVA Prospect Isolation | Section 3.C | Missing | Filter: Patent Managers, Valuation, Licensing | **Not Implemented** |
| **6. GIPC Email Campaign Engine** | 12-Touchpoint GIPC Sequence | Section 4 (Weeks 1–11) | Generic campaigns only | Pre-load 12 milestone campaigns into scheduler | **Not Implemented** |
| | Dynamic Paid Delegate Suppression | Section 4 (Week 4) | Missing | Exclude paid contacts automatically from promos | **Not Implemented** |
| | Group Booking / Corporate Offers | Section 4 (Week 5) | Missing | 3+ delegate discount triggers | **Not Implemented** |
| **7. Behavioural Retargeting** | Speaker vs. Pricing Click Tagging | Section 4 (Week 3) | Link clicks tracked in DB | Tag contact based on URL category clicked | **Partially Implemented** |
| | Automated Cross-Sell Trigger | Section 4 (Week 3) | Missing | GIPC paid -> 24h wait -> CPVA invite | **Not Implemented** |
| | 2-Click Valuation Intent Trigger | Section 3.C | Missing | 2 clicks on valuation -> CPVA high-intent drip | **Not Implemented** |
| **8. Registration & Payment Gateway** | Real-Time Payment Webhook | Section 3.A, 4 | Stripe webhook only | Add generic webhook endpoint (Razorpay/Custom) | **Partially Implemented** |
| | Idempotent Transaction Logging | Section 3.A | Missing | Add `PaymentTransaction` & idempotency log | **Not Implemented** |
| | Instant Status & Attribution Sync | Section 3.A | Missing | Connect payment to contact & campaign referrer | **Not Implemented** |
| **9. WhatsApp Business Automation** | WhatsApp Cloud API Integration | Section 1, 3.A | Missing | Build Meta WhatsApp Cloud API service wrapper | **Not Implemented** |
| | Touchpoint 1: Instant Receipt (10s) | Section 3.B.1 | Missing | Trigger upon payment success webhook | **Not Implemented** |
| | Touchpoint 2: Calendar & Approval Kit | Section 3.B.2 | Missing | Send calendar invite + justification letter | **Not Implemented** |
| | Touchpoint 3: T-30 Days Agenda Digest | Section 3.B.3 | Missing | Scheduled WhatsApp PDF dispatch (Jan 5) | **Not Implemented** |
| | Touchpoint 4: T-7 Days Travel & Venue | Section 3.B.4 | Missing | Scheduled WhatsApp location pin & hotel info | **Not Implemented** |
| | Touchpoint 5: T-24 Hours VIP QR Badge | Section 3.B.5 | Missing | WhatsApp QR pass dispatch | **Not Implemented** |
| | Touchpoint 6: Post-Event Certificates | Section 3.B.6 | Missing | WhatsApp digital participation certificate (Feb 6) | **Not Implemented** |
| **10. CPVA Certification Funnel** | Dedicated 3-Day Course Funnel | Section 3.C | Missing | Implement 8–10 Feb CPVA funnel workflows | **Not Implemented** |
| | Scarcity Notification Engine | Section 4 (Week 8, 10)| Missing | Alerts: "Final 8 Seats", "Last 3 Seats" | **Not Implemented** |
| | Cohort Onboarding & Workbook | Section 3.C | Missing | Excel workbook & course logistics drip | **Not Implemented** |
| **11. Live 25-Seat Management** | Hard 25-Seat Cohort Cap | Section 3.C | Missing | Atomic MongoDB `findOneAndUpdate` counter | **Not Implemented** |
| | Real-Time Live Seat Counter | Section 3.C | Missing | Real-time seat allocation & reservation locking | **Not Implemented** |
| **12. Document Generation** | Automated Invoice PDF (10s) | Section 3.B.1 | Missing | Headless HTML-to-PDF / PDFKit invoice generator | **Not Implemented** |
| | Corporate Justification Letters | Section 3.B.2 | Missing | Dynamic corporate approval letter generator | **Not Implemented** |
| | ICS Calendar Files | Section 3.B.2 | Missing | 1-click GIPC & CPVA calendar invite generator | **Not Implemented** |
| | Digital Certificates (GIPC & CPVA) | Section 3.B.6, 3.C | Missing | Personalized cryptographic certificate generator | **Not Implemented** |
| **13. QR Entry Badge Management** | Signed QR Token Generation | Section 3.B.5 | Missing | HMAC-SHA256 signed QR badge tokens | **Not Implemented** |
| | Badge PDF Creation & Dispatch | Section 3.B.5 | Missing | Printable & mobile VIP pass generation | **Not Implemented** |
| | Check-In Validation Scanner API | Section 3.B.5 | Missing | `/api/checkin/scan` endpoint with duplicate block | **Not Implemented** |
| **14. Analytics & ROI Dashboard** | Unified Email & WhatsApp Metrics | Section 3.A | Email metrics only | Add WhatsApp delivery/read rates & ROI tracking | **Partially Implemented** |
| | Campaign Attribution & CPA | Section 3.A | Missing | Track revenue and cost per registration | **Not Implemented** |
| **15. Reporting & Project Closure** | Weekly Funnel Reports | Section 4 (Week 5) | Missing | Automated weekly conversion export | **Not Implemented** |
| | Post-Event Clean Handover Package | Section 4 (Week 12) | Missing | Engaged audience CSV export by 12 Feb 2027 | **Not Implemented** |

---

## Detailed Gap Summary

1. **Email Delivery Layer:** The existing SES integration is robust and verified working in `ap-south-1` (tested live). It requires:
   - Configuration set alignment (`my-first-configuration-set` / GIPC production config set).
   - Lifecycle quota limiter (25,00,000 cap).
   - SNS subscription for automated bounce handling.

2. **Data Model Layer:** The database models currently represent basic single-author newsletters. They must be augmented with:
   - `Contact` enterprise attributes (Designation, Company, Industry, Persona, Attendance status, Scores).
   - `EventRegistration` and `PaymentTransaction` collections.
   - `CPVASeat` atomic counter collection.
   - `WhatsAppMessage` message log and webhook status tracker.
   - `Document` and `Badge` tracking schemas.

3. **Automation & Omnichannel Layer:** MailCheap currently lacks WhatsApp, external payment webhooks, dynamic PDF generation, and event QR scanning. These modules will be integrated modularly into the existing Next.js App Router architecture.
