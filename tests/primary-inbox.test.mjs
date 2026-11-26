import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrimaryInboxMode } from "../lib/config.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";

process.env.BETTER_AUTH_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.APP_URL = "https://mail.example.com";

const CAMPAIGN = {
	format: "rich",
	subject: "Executive Briefing",
	previewText: "Key conference details",
	html: '<p>Welcome delegates! Visit <a href="https://example.com/agenda">our agenda</a> for more info.</p>',
};

const NEWSLETTER = {
	_id: "64f1a2b3c4d5e6f7a8b9c0a1",
	name: "Global IP Convention",
	slug: "gipc",
	fromName: "GIPC Organizers",
	fromEmail: "updates@example.com",
	postalAddress: "123 Conference Way",
};

const CONTACT = {
	_id: "64f1a2b3c4d5e6f7a8b9c0d1",
	email: "delegate@example.com",
	firstName: "Alex",
};

describe("Primary Inbox Delivery Mode", () => {
	it("omits bulk headers, tracking pixel, and link rewrites when PRIMARY_INBOX_MODE is true", () => {
		const prev = process.env.PRIMARY_INBOX_MODE;
		process.env.PRIMARY_INBOX_MODE = "true";
		try {
			assert.equal(isPrimaryInboxMode(), true);

			const email = buildRecipientEmail({
				campaign: CAMPAIGN,
				newsletter: NEWSLETTER,
				contact: CONTACT,
				messageId: "64f1a2b3c4d5e6f7a8b9c0e1",
			});

			// 1. Bulk headers stripped to prevent Gmail Promotions tab
			assert.deepEqual(email.headers, {}, "Bulk List-Unsubscribe headers must be omitted");

			// 2. No open tracking pixel
			assert.ok(!email.html.includes("/o/64f1a2b3c4d5e6f7a8b9c0e1"), "Open tracking pixel must be omitted");

			// 3. Links remain clean and direct (no /c/ tracking redirect wrappers)
			assert.ok(email.html.includes('href="https://example.com/agenda"'), "Links must stay direct and untracked");
			assert.ok(!email.html.includes("/c/"), "No click tracking redirects");

			// 4. CAN-SPAM compliant unsubscribe link remains in body footer
			assert.ok(email.html.includes("/unsubscribe?token="), "Recipient unsubscribe link must be in body footer");
			assert.ok(email.text.includes("/unsubscribe?token="), "Recipient unsubscribe link must be in text body");

			// 5. Preheader avoids hidden repeating entity spam trigger
			assert.ok(!email.html.includes("&#847;&zwnj;&nbsp;"), "Preheader should not contain spammy padding characters");
		} finally {
			if (prev === undefined) {
				delete process.env.PRIMARY_INBOX_MODE;
			} else {
				process.env.PRIMARY_INBOX_MODE = prev;
			}
		}
	});

	it("preserves standard newsletter headers and tracking when PRIMARY_INBOX_MODE is off", () => {
		const prev = process.env.PRIMARY_INBOX_MODE;
		delete process.env.PRIMARY_INBOX_MODE;
		try {
			assert.equal(isPrimaryInboxMode(), false);

			const email = buildRecipientEmail({
				campaign: CAMPAIGN,
				newsletter: NEWSLETTER,
				contact: CONTACT,
				messageId: "64f1a2b3c4d5e6f7a8b9c0e1",
			});

			assert.ok(email.headers["List-Unsubscribe"], "List-Unsubscribe header present in standard mode");
			assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
			assert.ok(email.html.includes("/o/64f1a2b3c4d5e6f7a8b9c0e1"), "Open tracking pixel present in standard mode");
		} finally {
			if (prev !== undefined) process.env.PRIMARY_INBOX_MODE = prev;
		}
	});
});
