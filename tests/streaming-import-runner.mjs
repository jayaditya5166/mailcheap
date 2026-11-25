import assert from "node:assert/strict";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import dns from "node:dns";
import Papa from "papaparse";
import { connectDb } from "../lib/db.js";
import { scoped } from "../lib/account-scope.js";
import Contact from "../models/Contact.js";
import ContactImport from "../models/ContactImport.js";
import LeftOutContact from "../models/LeftOutContact.js";
import Suppression from "../models/Suppression.js";
import Newsletter from "../models/Newsletter.js";
import Account from "../models/Account.js";
import { streamCsvAndImport, generateErrorReportCsv } from "../lib/streaming-importer.js";
import { cancelContactImport, processImportRows } from "../lib/contact-import.js";
import { normalizeImportRow, planColumns, readColumnPlan, sanitizeImportRow } from "../lib/csv-import.js";

// Bypass local router DNS resolution issues for MongoDB Atlas SRV lookups
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const TEST_ACCOUNT_ID = new mongoose.Types.ObjectId("777777777777777777777771");
const TEST_ACCOUNT_B_ID = new mongoose.Types.ObjectId("777777777777777777777779");
const TEST_OWNER_A_ID = new mongoose.Types.ObjectId("777777777777777777777773");
const TEST_OWNER_B_ID = new mongoose.Types.ObjectId("777777777777777777777774");
const TEST_NEWSLETTER_ID = new mongoose.Types.ObjectId("777777777777777777777772");
const TEST_NEWSLETTER_B_ID = new mongoose.Types.ObjectId("777777777777777777777778");

const testAccount = { _id: TEST_ACCOUNT_ID, contactFields: [] };
const testAccountB = { _id: TEST_ACCOUNT_B_ID, contactFields: [] };

function getMemoryUsageMB() {
	const mem = process.memoryUsage();
	return {
		rss: Math.round(mem.rss / 1024 / 1024),
		heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
		heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
	};
}

async function cleanupTestData() {
	await Contact.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await Contact.deleteMany({ accountId: TEST_ACCOUNT_B_ID });
	await ContactImport.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await ContactImport.deleteMany({ accountId: TEST_ACCOUNT_B_ID });
	await LeftOutContact.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await LeftOutContact.deleteMany({ accountId: TEST_ACCOUNT_B_ID });
	await Suppression.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await Suppression.deleteMany({ accountId: TEST_ACCOUNT_B_ID });
}

async function seedTestPrerequisites() {
	await Account.updateOne(
		{ _id: TEST_ACCOUNT_ID },
		{ $set: { name: "Test Enterprise Account", ownerId: TEST_OWNER_A_ID } },
		{ upsert: true }
	);
	await Account.updateOne(
		{ _id: TEST_ACCOUNT_B_ID },
		{ $set: { name: "Test Isolated Account B", ownerId: TEST_OWNER_B_ID } },
		{ upsert: true }
	);
	await Newsletter.updateOne(
		{ accountId: TEST_ACCOUNT_ID, _id: TEST_NEWSLETTER_ID },
		{
			$set: {
				accountId: TEST_ACCOUNT_ID,
				name: "GIPC 2027 Official",
				slug: "gipc-2027-test-slug",
				fromName: "GIPC Organizers",
				fromEmail: "updates@updates.globalipconvention.com",
			},
		},
		{ upsert: true }
	);
	await Newsletter.updateOne(
		{ accountId: TEST_ACCOUNT_B_ID, _id: TEST_NEWSLETTER_B_ID },
		{
			$set: {
				accountId: TEST_ACCOUNT_B_ID,
				name: "Other Newsletter B",
				slug: "other-newsletter-b-slug",
				fromName: "Other Team",
				fromEmail: "team@other.example.com",
			},
		},
		{ upsert: true }
	);
}

async function runTestSuite() {
	console.log("================================================================================");
	console.log("PHASE 3 RIGOROUS VERIFICATION SUITE & RECONCILIATION ENGINE");
	console.log("================================================================================");

	await connectDb();
	await cleanupTestData();
	await seedTestPrerequisites();

	const initialMem = getMemoryUsageMB();
	console.log(`[INIT] Initial Memory Baseline: RSS ${initialMem.rss}MB, Heap ${initialMem.heapUsed}MB\n`);

	// ============================================================================
	// SECTION 1: STAGE-BY-STAGE TIMING BREAKDOWN (10,000 RECORDS)
	// ============================================================================
	console.log("--------------------------------------------------------------------------------");
	console.log("SECTION 1: STAGE-BY-STAGE PIPELINE PROFILING (10,000 Records)");
	console.log("--------------------------------------------------------------------------------");

	const rawLines = [];
	rawLines.push("Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status\n");
	for (let i = 1; i <= 10000; i++) {
		rawLines.push(
			`profile_${i}@bench.example.com,First${i},Last${i},Enterprise Org ${i % 100},IP Director,Legal,Hyderabad,IN_HOUSE_COUNSEL,INVITED\n`
		);
	}
	const fullCsvText = rawLines.join("");

	// Stage 1: Line Reading & RFC-4180 Parsing
	const t1Start = performance.now();
	const parsedData = Papa.parse(fullCsvText, { header: true, skipEmptyLines: true });
	const t1Duration = performance.now() - t1Start;
	console.log(`  Stage 1 (CSV Parsing - Papa.parse):       ${t1Duration.toFixed(2)} ms (${Math.round((10000 / t1Duration) * 1000)} rec/sec)`);

	// Stage 2: Normalization & Syntax Validation
	const t2Start = performance.now();
	const headers = Object.keys(parsedData.data[0] || {});
	const plan = planColumns(headers, []);
	const { columns, profile } = readColumnPlan(plan, []);
	const normalizedRows = [];
	let invalidSyntaxCount = 0;
	for (const raw of parsedData.data) {
		const norm = normalizeImportRow(raw, columns, { profile });
		if (norm && norm.email) {
			normalizedRows.push(norm);
		} else {
			invalidSyntaxCount++;
		}
	}
	const t2Duration = performance.now() - t2Start;
	console.log(`  Stage 2 (Normalization & Validation):     ${t2Duration.toFixed(2)} ms (${Math.round((10000 / t2Duration) * 1000)} rec/sec)`);

	// Stage 3: In-File Deduplication (Set Hashing)
	const t3Start = performance.now();
	const seenSet = new Set();
	const uniqueRows = [];
	let inDuplicateCount = 0;
	for (const row of normalizedRows) {
		if (seenSet.has(row.email)) {
			inDuplicateCount++;
		} else {
			seenSet.add(row.email);
			uniqueRows.push(row);
		}
	}
	const t3Duration = performance.now() - t3Start;
	console.log(`  Stage 3 (In-File Deduplication):          ${t3Duration.toFixed(2)} ms (${Math.round((10000 / t3Duration) * 1000)} rec/sec)`);

	// Stage 4: Account Suppression Querying
	const t4Start = performance.now();
	const sampleEmails = uniqueRows.slice(0, 1000).map((r) => r.email);
	const suppressedFound = await Suppression.distinct("email", { accountId: TEST_ACCOUNT_ID, email: { $in: sampleEmails } });
	const t4Duration = performance.now() - t4Start;
	console.log(`  Stage 4 (Suppression Query over WAN):     ${t4Duration.toFixed(2)} ms (1,000-email sample check)`);

	// Stage 5: Database Write (MongoDB bulkWrite over WAN)
	const t5Start = performance.now();
	const sampleWrites = uniqueRows.slice(0, 1000).map((c) => ({
		updateOne: {
			filter: { accountId: TEST_ACCOUNT_ID, newsletterId: TEST_NEWSLETTER_ID, email: c.email },
			update: {
				$setOnInsert: {
					accountId: TEST_ACCOUNT_ID,
					newsletterId: TEST_NEWSLETTER_ID,
					email: c.email,
					status: "subscribed",
					subscribedAt: new Date(),
				},
				$set: {
					firstName: c.firstName,
					lastName: c.lastName,
					fullName: `${c.firstName} ${c.lastName}`.trim(),
					company: c.company,
					persona: c.persona,
				},
			},
			upsert: true,
		},
	}));
	const writeRes = await Contact.bulkWrite(sampleWrites, { ordered: false });
	const t5Duration = performance.now() - t5Start;
	console.log(`  Stage 5 (Live MongoDB bulkWrite - 1,000):  ${t5Duration.toFixed(2)} ms (${Math.round((1000 / t5Duration) * 1000)} rec/sec live WAN write)`);
	console.log(`  --> Key Finding: CPU Parser Throughput: ~${Math.round((10000 / (t1Duration + t2Duration + t3Duration)) * 1000)} rec/sec | Live DB Network Write: ~${Math.round((1000 / t5Duration) * 1000)} rec/sec\n`);

	// Clean up profiling sample
	await cleanupTestData();

	// ============================================================================
	// SECTION 2: 5-TIER CAPACITY & EXACT RECONCILIATION MATRICES
	// ============================================================================
	console.log("--------------------------------------------------------------------------------");
	console.log("SECTION 2: 5-TIER RECONCILIATION & DATA CAPACITY TESTS");
	console.log("--------------------------------------------------------------------------------");

	// ----------------------------------------------------
	// TIER 1: EXACT 10 RECORDS
	// ----------------------------------------------------
	console.log("\n>>> [TIER 1] 10 Records (Validation, Mapping, Dry-Run vs Live)");
	const csv10Lines = [
		"Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status",
		"priya.sharma@tcs.example.com,Priya,Sharma,TCS,IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED",
		"rahul.verma@lawfirm.example.com,Rahul,Verma,Verma & Co,Partner,Legal,Delhi,LAW_FIRM,REGISTERED",
		"vikram.aditya@biotech.example.com,Vikram,Aditya,BioTech Labs,R&D Director,Pharma,Bangalore,STARTUP_RND,DELEGATE",
		"ananya.sen@patent.example.com,Ananya,Sen,Patent Corp,Analyst,IP,Mumbai,CPVA_PROSPECT,QUALIFIED",
		"priya.sharma@tcs.example.com,Priya,Sharma,TCS,IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED", // Duplicate 1
		"invalid-email-no-at,Bad,User,None,None,None,None,None,NONE", // Invalid 1
		"suresh.patel@auto.example.com,Suresh,Patel,AutoTech,VP Engineering,Auto,Pune,IN_HOUSE_COUNSEL,INVITED",
		"deepa.rao@ipfirm.example.com,Deepa,Rao,Rao Legal,Associate,Legal,Chennai,LAW_FIRM,DELEGATE",
		"kavita.nair@health.example.com,Kavita,Nair,HealthCare Plus,Chief Counsel,Pharma,Hyderabad,IN_HOUSE_COUNSEL,REGISTERED",
		"rahul.verma@lawfirm.example.com,Rahul,Verma,Verma & Co,Partner,Legal,Delhi,LAW_FIRM,REGISTERED", // Duplicate 2
	];
	const csv10Text = csv10Lines.join("\n");

	// A. Dry-Run
	const countBeforeDry = await Contact.countDocuments(scoped(testAccount));
	const tier1Dry = await streamCsvAndImport({
		stream: csv10Text,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: true,
		fileName: "tier1-dry.csv",
		total: 10,
	});
	const countAfterDry = await Contact.countDocuments(scoped(testAccount));

	assert.equal(countBeforeDry, 0);
	assert.equal(countAfterDry, 0, "Dry run must commit 0 records to database");
	assert.equal(tier1Dry.created, 7);
	assert.equal(tier1Dry.dropped.duplicate, 2);
	assert.equal(tier1Dry.dropped.invalid, 1);

	// Reconciliation Check:
	const tier1DryReconciled =
		tier1Dry.created +
		(tier1Dry.existing || 0) +
		tier1Dry.dropped.duplicate +
		tier1Dry.dropped.invalid +
		(tier1Dry.dropped.suppressed || 0);
	assert.equal(tier1DryReconciled, 10, "Tier 1 Dry Run reconciliation must equal 10");
	console.log(`  [Tier 1 Dry-Run] Reconciled: 7 Created + 2 Duplicates + 1 Invalid = 10 Total Input. DB Writes: 0.`);

	// B. Live Commit
	const tier1Live = await streamCsvAndImport({
		stream: csv10Text,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "tier1-live.csv",
		total: 10,
	});
	const countAfterLive1 = await Contact.countDocuments(scoped(testAccount));
	assert.equal(countAfterLive1, 7, "DB count after Tier 1 live commit must be exactly 7");
	assert.equal(tier1Live.created, 7);
	assert.equal(tier1Live.dropped.duplicate, 2);
	assert.equal(tier1Live.dropped.invalid, 1);
	console.log(`  [Tier 1 Live Commit] Reconciled: 7 Created + 2 Duplicates + 1 Invalid = 10 Total Input. DB Records in Atlas: 7.`);

	// ----------------------------------------------------
	// TIER 2: EXACT 100 RECORDS
	// ----------------------------------------------------
	console.log("\n>>> [TIER 2] 100 Records (Suppression, Existing Updates, Invariants)");
	// Seed 2 suppressions
	await Suppression.create([
		{ accountId: TEST_ACCOUNT_ID, email: "bounced_counsel@example.com", reason: "bounce", detail: "Hard bounce test seed" },
		{ accountId: TEST_ACCOUNT_ID, email: "complained_partner@example.com", reason: "complaint", detail: "Spam complaint seed" },
	]);

	const csv100Lines = ["Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status"];
	// 3 Existing records to update
	csv100Lines.push("priya.sharma@tcs.example.com,Priya,Sharma,TCS New Branch,Global IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,REGISTERED");
	csv100Lines.push("rahul.verma@lawfirm.example.com,Rahul,Verma,Verma Law LLP,Senior Partner,Legal,Delhi,LAW_FIRM,SPEAKER");
	csv100Lines.push("vikram.aditya@biotech.example.com,Vikram,Aditya,BioTech Labs Global,CTO,Pharma,Bangalore,STARTUP_RND,SPONSOR");
	// 2 Existing records identical
	csv100Lines.push("ananya.sen@patent.example.com,Ananya,Sen,Patent Corp,Analyst,IP,Mumbai,CPVA_PROSPECT,QUALIFIED");
	csv100Lines.push("suresh.patel@auto.example.com,Suresh,Patel,AutoTech,VP Engineering,Auto,Pune,IN_HOUSE_COUNSEL,INVITED");
	// 2 Suppressed records
	csv100Lines.push("bounced_counsel@example.com,Bounced,User,Bad Corp,Counsel,IT,Pune,IN_HOUSE_COUNSEL,INVITED");
	csv100Lines.push("complained_partner@example.com,Complained,User,Grievance LLC,Partner,Legal,Delhi,LAW_FIRM,INVITED");
	// 1 Invalid record
	csv100Lines.push("malformed_email_without_tld@nonexistent,No,Domain,None,None,None,None,None,NONE");
	// 2 In-file duplicates
	csv100Lines.push("tier2_new_contact_1@corp.example.com,First1,Last1,Corp1,Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED");
	csv100Lines.push("tier2_new_contact_1@corp.example.com,First1,Last1,Corp1,Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED"); // Dup of #1
	csv100Lines.push("tier2_new_contact_2@corp.example.com,First2,Last2,Corp2,Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED");
	csv100Lines.push("tier2_new_contact_2@corp.example.com,First2,Last2,Corp2,Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED"); // Dup of #2
	// 88 Unique new contacts (total lines = 3 + 2 + 2 + 1 + 4 + 88 = 100)
	for (let i = 3; i <= 90; i++) {
		csv100Lines.push(`tier2_new_contact_${i}@corp.example.com,First${i},Last${i},Corp${i},Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED`);
	}
	assert.equal(csv100Lines.length - 1, 100, "Tier 2 CSV must have exactly 100 data rows");

	const countBefore100 = await Contact.countDocuments(scoped(testAccount));
	const tier2Res = await streamCsvAndImport({
		stream: csv100Lines.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "tier2-100.csv",
		total: 100,
	});
	const countAfter100 = await Contact.countDocuments(scoped(testAccount));

	// Verification:
	// Created: 90 (2 from dup pairs + 88 = 90)
	// Existing (matched & updated/skipped): 5
	// Duplicates: 2
	// Invalid: 1
	// Suppressed: 2
	// Total: 90 + 5 + 2 + 1 + 2 = 100
	const tier2Total =
		tier2Res.created +
		tier2Res.existing +
		tier2Res.dropped.duplicate +
		tier2Res.dropped.invalid +
		tier2Res.dropped.suppressed;

	console.log(`  [Tier 2 Reconciliation]`);
	console.log(`    - Created:    ${tier2Res.created}`);
	console.log(`    - Existing:   ${tier2Res.existing} (3 updated with new metadata, 2 matched existing)`);
	console.log(`    - Duplicates: ${tier2Res.dropped.duplicate}`);
	console.log(`    - Invalid:    ${tier2Res.dropped.invalid}`);
	console.log(`    - Suppressed: ${tier2Res.dropped.suppressed}`);
	console.log(`    - TOTAL:      ${tier2Total} (Exact match to 100 Input Records)`);
	console.log(`    - DB Counts:  Before = ${countBefore100}, After = ${countAfter100} (+${countAfter100 - countBefore100} new records created)`);

	assert.equal(tier2Total, 100, "Tier 2 reconciliation must equal exactly 100");
	assert.equal(tier2Res.created, 90);
	assert.equal(tier2Res.existing, 5);
	assert.equal(tier2Res.dropped.duplicate, 2);
	assert.equal(tier2Res.dropped.invalid, 1);
	assert.equal(tier2Res.dropped.suppressed, 2);
	assert.equal(countAfter100 - countBefore100, 90);

	// Verify updated metadata on Priya
	const priyaCheck = await Contact.findOne(scoped(testAccount, { email: "priya.sharma@tcs.example.com" })).lean();
	assert.equal(priyaCheck.company, "TCS New Branch");
	assert.equal(priyaCheck.designation, "Global IP Head");
	assert.equal(priyaCheck.gipcStatus, "REGISTERED");

	// ----------------------------------------------------
	// TIER 3: EXACT 1,000 RECORDS
	// ----------------------------------------------------
	console.log("\n>>> [TIER 3] 1,000 Records (Multi-Chunk Processing & Error Report)");
	const csv1000Lines = ["Email,First Name,Company,Designation,Persona"];
	// 10 Existing contacts
	for (let i = 1; i <= 10; i++) {
		csv1000Lines.push(`tier2_new_contact_${i}@corp.example.com,UpdatedName${i},UpdatedCorp${i},Chief Counsel,IN_HOUSE_COUNSEL`);
	}
	// 10 In-file duplicates
	for (let i = 1; i <= 5; i++) {
		csv1000Lines.push(`tier3_dup_${i}@domain.example.com,Dup${i},DupCorp,Lawyer,LAW_FIRM`);
		csv1000Lines.push(`tier3_dup_${i}@domain.example.com,Dup${i},DupCorp,Lawyer,LAW_FIRM`); // Duplicate
	}
	// 5 Invalid emails
	for (let i = 1; i <= 5; i++) {
		csv1000Lines.push(`invalid_no_at_${i},BadUser,BadCorp,None,None`);
	}
	// 5 Suppressed emails (seed 3 more)
	await Suppression.create([
		{ accountId: TEST_ACCOUNT_ID, email: "suppressed_tier3_1@example.com", reason: "bounce" },
		{ accountId: TEST_ACCOUNT_ID, email: "suppressed_tier3_2@example.com", reason: "bounce" },
		{ accountId: TEST_ACCOUNT_ID, email: "suppressed_tier3_3@example.com", reason: "complaint" },
	]);
	csv1000Lines.push("bounced_counsel@example.com,Bounced,User,Bad Corp,Counsel,IN_HOUSE_COUNSEL");
	csv1000Lines.push("complained_partner@example.com,Complained,User,Grievance LLC,Partner,LAW_FIRM");
	csv1000Lines.push("suppressed_tier3_1@example.com,Supp1,Corp,Counsel,IN_HOUSE_COUNSEL");
	csv1000Lines.push("suppressed_tier3_2@example.com,Supp2,Corp,Counsel,IN_HOUSE_COUNSEL");
	csv1000Lines.push("suppressed_tier3_3@example.com,Supp3,Corp,Counsel,IN_HOUSE_COUNSEL");
	// 970 New unique contacts (total = 10 + 10 + 5 + 5 + 970 = 1,000)
	for (let i = 1; i <= 970; i++) {
		csv1000Lines.push(`tier3_unique_${i}@enterprise.example.com,User${i},Enterprise${i},Counsel,IN_HOUSE_COUNSEL`);
	}
	assert.equal(csv1000Lines.length - 1, 1000, "Tier 3 CSV must have exactly 1,000 data rows");

	const countBefore1000 = await Contact.countDocuments(scoped(testAccount));
	const tier3Res = await streamCsvAndImport({
		stream: csv1000Lines.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 500,
		dryRun: false,
		fileName: "tier3-1000.csv",
		total: 1000,
	});
	const countAfter1000 = await Contact.countDocuments(scoped(testAccount));

	const tier3Total =
		tier3Res.created +
		tier3Res.existing +
		tier3Res.dropped.duplicate +
		tier3Res.dropped.invalid +
		tier3Res.dropped.suppressed;

	console.log(`  [Tier 3 Reconciliation]`);
	console.log(`    - Created:    ${tier3Res.created}`);
	console.log(`    - Existing:   ${tier3Res.existing} (10 updated in database)`);
	console.log(`    - Duplicates: ${tier3Res.dropped.duplicate}`);
	console.log(`    - Invalid:    ${tier3Res.dropped.invalid}`);
	console.log(`    - Suppressed: ${tier3Res.dropped.suppressed}`);
	console.log(`    - TOTAL:      ${tier3Total} (Exact match to 1,000 Input Records)`);
	console.log(`    - DB Counts:  Before = ${countBefore1000}, After = ${countAfter1000} (+${countAfter1000 - countBefore1000} created)`);

	assert.equal(tier3Total, 1000);
	assert.equal(tier3Res.created, 975);
	assert.equal(tier3Res.existing, 10);
	assert.equal(tier3Res.dropped.duplicate, 5);
	assert.equal(tier3Res.dropped.invalid, 5);
	assert.equal(tier3Res.dropped.suppressed, 5);
	assert.equal(countAfter1000 - countBefore1000, 975);

	// Error report verification
	const errorCsv3 = await generateErrorReportCsv(testAccount, tier3Res.importId);
	assert.ok(errorCsv3.includes("Email,Reason,Can Bring Back"));
	assert.ok(errorCsv3.includes("invalid_no_at_1"));
	assert.ok(errorCsv3.includes("bounced_counsel@example.com"));
	console.log(`  ✓ Tier 3 error report CSV verified: 15 excluded records cataloged with recovery flags.`);

	// ----------------------------------------------------
	// TIER 4: EXACT 10,000 RECORDS (Live Atlas Ingestion)
	// ----------------------------------------------------
	console.log("\n>>> [TIER 4] 10,000 Records (Live MongoDB Atlas Stress Ingestion)");
	const csv10kLines = ["Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status"];
	// 50 In-file duplicates (25 pairs)
	for (let i = 1; i <= 25; i++) {
		csv10kLines.push(`tier4_dup_${i}@scale.example.com,Dup${i},User,Scale Corp,Counsel,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED`);
		csv10kLines.push(`tier4_dup_${i}@scale.example.com,Dup${i},User,Scale Corp,Counsel,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED`);
	}
	// 30 Invalid emails
	for (let i = 1; i <= 30; i++) {
		csv10kLines.push(`invalid_email_${i}_at_bad,Bad${i},User,None,None,None,None,None,NONE`);
	}
	// 20 Suppressed emails (seed 20)
	const suppressions10k = [];
	for (let i = 1; i <= 20; i++) {
		suppressions10k.push({ accountId: TEST_ACCOUNT_ID, email: `suppressed_tier4_${i}@scale.example.com`, reason: "bounce" });
		csv10kLines.push(`suppressed_tier4_${i}@scale.example.com,Supp${i},User,SuppCorp,None,None,None,None,NONE`);
	}
	await Suppression.create(suppressions10k);
	// 9,900 New unique contacts (total = 50 + 30 + 20 + 9,900 = 10,000)
	for (let i = 1; i <= 9900; i++) {
		csv10kLines.push(`tier4_unique_${i}@scale.example.com,First${i},Last${i},Enterprise Corp ${i % 200},IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED`);
	}
	assert.equal(csv10kLines.length - 1, 10000, "Tier 4 CSV must have exactly 10,000 data rows");

	const countBefore10k = await Contact.countDocuments(scoped(testAccount));
	const memBefore10k = getMemoryUsageMB();
	const t4StartLive = Date.now();

	const tier4Res = await streamCsvAndImport({
		stream: csv10kLines.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 1000,
		dryRun: false,
		fileName: "tier4-10k-live.csv",
		total: 10000,
	});

	const duration10k = (Date.now() - t4StartLive) / 1000;
	const memAfter10k = getMemoryUsageMB();
	const countAfter10k = await Contact.countDocuments(scoped(testAccount));

	const tier4Total =
		tier4Res.created +
		(tier4Res.existing || 0) +
		tier4Res.dropped.duplicate +
		tier4Res.dropped.invalid +
		tier4Res.dropped.suppressed;

	console.log(`  [Tier 4 Reconciliation & Performance]`);
	console.log(`    - Total Input:    10,000`);
	console.log(`    - Created:        ${tier4Res.created}`);
	console.log(`    - Existing:       ${tier4Res.existing || 0}`);
	console.log(`    - Duplicates:     ${tier4Res.dropped.duplicate}`);
	console.log(`    - Invalid:        ${tier4Res.dropped.invalid}`);
	console.log(`    - Suppressed:     ${tier4Res.dropped.suppressed}`);
	console.log(`    - TOTAL:          ${tier4Total} (Exact match to 10,000 Input Records)`);
	console.log(`    - DB Counts:      Before = ${countBefore10k}, After = ${countAfter10k} (+${countAfter10k - countBefore10k} created)`);
	console.log(`    - Duration:       ${duration10k.toFixed(2)}s (${Math.round(10000 / duration10k)} rec/sec complete live write over WAN)`);
	console.log(`    - Memory:         RSS Before = ${memBefore10k.rss}MB, After = ${memAfter10k.rss}MB (Delta: +${memAfter10k.rss - memBefore10k.rss}MB)`);

	assert.equal(tier4Total, 10000);
	assert.equal(tier4Res.created, 9925);
	assert.equal(tier4Res.dropped.duplicate, 25);
	assert.equal(tier4Res.dropped.invalid, 30);
	assert.equal(tier4Res.dropped.suppressed, 20);
	assert.equal(countAfter10k - countBefore10k, 9925);

	// ----------------------------------------------------
	// TIER 5: EXACT 150,000 RECORDS (Controlled Capacity Test)
	// ----------------------------------------------------
	console.log("\n>>> [TIER 5] 150,000 Records (Streaming Parser & Memory Stability Test - Dry Run)");
	console.log("  [CLARIFICATION] Tier 5 executes as a dry-run streaming capacity test.");
	console.log("  It validates constant-memory line streaming, RFC-4180 parsing, and validation without writing 150k rows to DB.");

	async function* generate150kReconciled() {
		yield "Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status\n";
		// 1,000 Duplicates (500 pairs)
		for (let i = 1; i <= 500; i++) {
			yield `tier5_dup_${i}@stream.example.com,Dup${i},User,DupCorp,Counsel,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED\n`;
			yield `tier5_dup_${i}@stream.example.com,Dup${i},User,DupCorp,Counsel,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED\n`;
		}
		// 500 Invalid emails
		for (let i = 1; i <= 500; i++) {
			yield `tier5_invalid_no_domain_${i},Bad${i},User,None,None,None,None,None,NONE\n`;
		}
		// 148,500 Unique records (total lines = 1000 + 500 + 148500 = 150,000)
		for (let i = 1; i <= 148500; i++) {
			yield `tier5_delegate_${i}@stream.example.com,First${i},Last${i},Corp ${i % 500},General Counsel,IP,Hyderabad,IN_HOUSE_COUNSEL,INVITED\n`;
		}
	}

	const readable150k = Readable.from(generate150kReconciled());
	const memBefore150k = getMemoryUsageMB();
	const countBefore150k = await Contact.countDocuments(scoped(testAccount));
	const tier5Start = Date.now();

	const tier5Res = await streamCsvAndImport({
		stream: readable150k,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 1000,
		dryRun: true,
		fileName: "tier5-150k-dry.csv",
		total: 150000,
		onProgress: ({ processed }) => {
			if (processed % 50000 === 0 || processed === 150000) {
				const cur = getMemoryUsageMB();
				const el = (Date.now() - tier5Start) / 1000;
				console.log(`    Progress: ${processed.toLocaleString()} / 150,000 rows (${Math.round(processed / el)} rec/sec) | RSS: ${cur.rss}MB, Heap: ${cur.heapUsed}MB`);
			}
		},
	});

	const duration150k = (Date.now() - tier5Start) / 1000;
	const memAfter150k = getMemoryUsageMB();
	const countAfter150k = await Contact.countDocuments(scoped(testAccount));

	const tier5Total =
		tier5Res.created +
		(tier5Res.existing || 0) +
		tier5Res.dropped.duplicate +
		tier5Res.dropped.invalid +
		(tier5Res.dropped.suppressed || 0);

	console.log(`  [Tier 5 Reconciliation & Metrics]`);
	console.log(`    - Total Input:    150,000`);
	console.log(`    - Valid New:      ${tier5Res.created}`);
	console.log(`    - Duplicates:     ${tier5Res.dropped.duplicate}`);
	console.log(`    - Invalid:        ${tier5Res.dropped.invalid}`);
	console.log(`    - TOTAL:          ${tier5Total} (Exact match to 150,000 Input Records)`);
	console.log(`    - DB Counts:      Before = ${countBefore150k}, After = ${countAfter150k} (Exactly 0 writes in dry-run mode)`);
	console.log(`    - Duration:       ${duration150k.toFixed(2)}s (${Math.round(150000 / duration150k)} records/sec streaming throughput)`);
	console.log(`    - Memory:         RSS Before = ${memBefore150k.rss}MB, After = ${memAfter150k.rss}MB (Peak RSS: ${memAfter150k.rss}MB, Delta: +${memAfter150k.rss - memBefore150k.rss}MB)`);

	assert.equal(tier5Total, 150000);
	assert.equal(tier5Res.created, 149000);
	assert.equal(tier5Res.dropped.duplicate, 500);
	assert.equal(tier5Res.dropped.invalid, 500);
	assert.equal(countBefore150k, countAfter150k, "Dry run must strictly make 0 database writes");
	assert.ok(memAfter150k.rss < 250, "Memory must remain constant and under 250MB");

	// ============================================================================
	// SECTION 3: REAL ACTIVE MID-STREAM CANCELLATION TEST
	// ============================================================================
	console.log("\n--------------------------------------------------------------------------------");
	console.log("SECTION 3: REAL ACTIVE MID-STREAM CANCELLATION TEST");
	console.log("--------------------------------------------------------------------------------");

	// We generate 2,500 records across 5 batches of 500 records.
	// Batches 1 and 2 write to MongoDB (1,000 records).
	// During progress of Batch 2, cancellation is triggered.
	// Batches 3, 4, 5 MUST NOT write to MongoDB.
	console.log("  Generating 2,500 records (5 batches of 500 rows)...");
	const cancelLines = ["Email,First Name,Company,Persona"];
	for (let i = 1; i <= 2500; i++) {
		cancelLines.push(`cancel_stream_${i}@stream-test.example.com,User${i},Corp${i},IN_HOUSE_COUNSEL`);
	}

	const countBeforeCancel = await Contact.countDocuments(scoped(testAccount));
	let cancellationTriggered = false;
	let batchesCompleted = 0;

	// Create import document directly so we have importId to cancel
	const cancelImportDoc = await ContactImport.create({
		accountId: TEST_ACCOUNT_ID,
		newsletterId: TEST_NEWSLETTER_ID,
		consent: true,
		consentText: "I agree",
		consentAt: new Date(),
		status: "processing",
		fileName: "cancel-active-stream.csv",
		source: "streaming-import",
		total: 2500,
	});

	console.log(`  Initialized Import ID: ${cancelImportDoc._id} (Status: processing)`);

	// Hook into streaming batches
	const cancelResult = await streamCsvAndImport({
		stream: cancelLines.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		importId: cancelImportDoc._id,
		batchSize: 500,
		dryRun: false,
		fileName: "cancel-active-stream.csv",
		total: 2500,
		onProgress: async ({ processed }) => {
			batchesCompleted++;
			console.log(`    [Progress] Batch ${batchesCompleted} completed: ${processed} rows processed`);
			// Trigger cancellation right after Batch 2 finishes writing
			if (processed >= 1000 && !cancellationTriggered) {
				cancellationTriggered = true;
				console.log(`    [ACTION] Triggering mid-stream cancellation after 1,000 records...`);
				const res = await cancelContactImport({
					account: testAccount,
					importId: cancelImportDoc._id,
				});
				console.log(`    [ACTION] cancelContactImport returned: status = ${res.contactImport?.status}`);
			}
		},
	});

	const countAfterCancel = await Contact.countDocuments(scoped(testAccount));
	const recordsWritten = countAfterCancel - countBeforeCancel;
	const recordsUnprocessed = 2500 - recordsWritten;

	console.log(`  [Cancellation Verification Results]`);
	console.log(`    - Job Status:           ${cancelResult.status}`);
	console.log(`    - Batches Completed:    ${batchesCompleted} (out of 5 planned)`);
	console.log(`    - Records Written to DB: ${recordsWritten} (Batches 1 & 2 only)`);
	console.log(`    - Records Unprocessed:   ${recordsUnprocessed} (Batches 3, 4, 5 aborted)`);
	console.log(`    - Final DB Reconciliation: Written (${recordsWritten}) + Unprocessed (${recordsUnprocessed}) = Total Input (2,500)`);

	assert.equal(cancelResult.status, "cancelled", "Stream result status must be 'cancelled'");
	assert.equal(recordsWritten, 1000, "Must have written exactly 1,000 records before cancellation halted the stream");
	assert.equal(recordsUnprocessed, 1500, "Exactly 1,500 records must remain unwritten / aborted");

	const finalCancelDoc = await ContactImport.findOne(scoped(testAccount, { _id: cancelImportDoc._id })).lean();
	assert.equal(finalCancelDoc.status, "cancelled", "Database ContactImport status must be 'cancelled'");
	assert.ok(finalCancelDoc.cancelledAt, "cancelledAt timestamp must be saved in database");
	console.log(`  ✓ Real active mid-stream cancellation VERIFIED: Stream aborted, 0 subsequent writes allowed.`);

	// ============================================================================
	// SECTION 4: DATA INTEGRITY & SUPPRESSION INVARIANT VERIFICATION
	// ============================================================================
	console.log("\n--------------------------------------------------------------------------------");
	console.log("SECTION 4: DATA INTEGRITY & STRICT SUPPRESSION INVARIANTS");
	console.log("--------------------------------------------------------------------------------");

	// 1. Unsubscribed Contact Invariant: Cannot be reinstated to active
	console.log("  Testing Unsubscribed Status Invariant...");
	await Contact.create({
		accountId: TEST_ACCOUNT_ID,
		newsletterId: TEST_NEWSLETTER_ID,
		email: "unsubscribed_delegate@legal.example.com",
		status: "unsubscribed",
		unsubscribedAt: new Date("2026-01-01"),
	});

	const unsubImportCsv = [
		"Email,First Name,Company,Persona",
		"unsubscribed_delegate@legal.example.com,Reinstated,Fake Corp,IN_HOUSE_COUNSEL",
	].join("\n");

	await streamCsvAndImport({
		stream: unsubImportCsv,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "unsub-test.csv",
	});

	const unsubContactAfter = await Contact.findOne(
		scoped(testAccount, { email: "unsubscribed_delegate@legal.example.com" })
	).lean();

	assert.equal(unsubContactAfter.status, "unsubscribed", "Unsubscribed contact must NEVER be moved back to subscribed/active");
	console.log("  ✓ Unsubscribed Invariant Passed: Re-importing an unsubscribed email strictly keeps status = 'unsubscribed'.");

	// 2. Hard-Bounce Invariant: Suppressed contacts remain dropped
	console.log("  Testing Hard-Bounce Invariant...");
	await Suppression.create({
		accountId: TEST_ACCOUNT_ID,
		email: "hard_bounce_partner@firm.example.com",
		reason: "bounce",
		detail: "Permanent 550 Mailbox not found",
	});

	const bounceImportRes = await streamCsvAndImport({
		stream: "Email,First Name\nhard_bounce_partner@firm.example.com,HardBounceUser",
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "bounce-test.csv",
	});

	assert.equal(bounceImportRes.dropped.suppressed, 1, "Hard-bounced email must be dropped as suppressed");
	const bouncedInContacts = await Contact.findOne(scoped(testAccount, { email: "hard_bounce_partner@firm.example.com" }));
	assert.equal(bouncedInContacts, null, "Suppressed email must not be created in Contact table");
	console.log("  ✓ Hard-Bounce Invariant Passed: Suppressed email was dropped (dropped.suppressed = 1, DB writes = 0).");

	// 3. Complaint Invariant
	console.log("  Testing Spam Complaint Invariant...");
	await Suppression.create({
		accountId: TEST_ACCOUNT_ID,
		email: "spam_complainant@firm.example.com",
		reason: "complaint",
		detail: "FBL Spam Complaint received",
	});

	const compImportRes = await streamCsvAndImport({
		stream: "Email,First Name\nspam_complainant@firm.example.com,ComplainantUser",
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "complaint-test.csv",
	});

	assert.equal(compImportRes.dropped.suppressed, 1, "Complained email must be dropped as suppressed");
	console.log("  ✓ Complaint Invariant Passed: Complained email was dropped.");

	// 4. Multi-Tenant Account Isolation Invariant
	console.log("  Testing Multi-Tenant Account Isolation...");
	const sharedEmail = "cross_tenant_counsel@patent.example.com";

	// Import into Account A
	await streamCsvAndImport({
		stream: `Email,First Name,Company\n${sharedEmail},Alice,Company A`,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
	});

	// Import same email into Account B
	await streamCsvAndImport({
		stream: `Email,First Name,Company\n${sharedEmail},Bob,Company B`,
		account: testAccountB,
		newsletterId: TEST_NEWSLETTER_B_ID,
		dryRun: false,
	});

	const contactInA = await Contact.findOne({ accountId: TEST_ACCOUNT_ID, email: sharedEmail }).lean();
	const contactInB = await Contact.findOne({ accountId: TEST_ACCOUNT_B_ID, email: sharedEmail }).lean();

	assert.ok(contactInA, "Contact must exist in Account A");
	assert.ok(contactInB, "Contact must exist in Account B");
	assert.equal(contactInA.company, "Company A");
	assert.equal(contactInB.company, "Company B");
	assert.equal(contactInA.firstName, "Alice");
	assert.equal(contactInB.firstName, "Bob");
	assert.notEqual(String(contactInA._id), String(contactInB._id), "Records must be completely isolated separate documents");
	console.log("  ✓ Multi-Tenant Isolation Passed: Same email across separate accounts creates isolated documents without leakage.");

	// 5. Missing Optional Fields Graceful Handling
	console.log("  Testing Missing Optional Fields Handling...");
	const minimalCsv = "Email\nminimalist_counsel@tcs.example.com";
	const minRes = await streamCsvAndImport({
		stream: minimalCsv,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
	});
	assert.equal(minRes.created, 1);
	const minContact = await Contact.findOne(scoped(testAccount, { email: "minimalist_counsel@tcs.example.com" })).lean();
	assert.equal(minContact.email, "minimalist_counsel@tcs.example.com");
	assert.equal(minContact.company, undefined);
	assert.equal(minContact.designation, undefined);
	assert.equal(minContact.gipcStatus, "NONE");
	console.log("  ✓ Missing Optional Fields Passed: Record created with default enums and omitted optional fields.");

	// Clean up test data
	await cleanupTestData();

	console.log("\n================================================================================");
	console.log("ALL 4 VERIFICATION SECTIONS & INVARIANTS PASSED SUCCESSFULLY!");
	console.log("================================================================================");
	process.exit(0);
}

runTestSuite().catch((err) => {
	console.error("\n[FATAL ERROR] TEST SUITE FAILED:", err);
	process.exit(1);
});
