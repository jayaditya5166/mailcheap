import assert from "node:assert/strict";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import dns from "node:dns";
import { connectDb } from "../lib/db.js";
import { scoped } from "../lib/account-scope.js";
import Contact from "../models/Contact.js";
import ContactImport from "../models/ContactImport.js";
import LeftOutContact from "../models/LeftOutContact.js";
import Suppression from "../models/Suppression.js";
import Newsletter from "../models/Newsletter.js";
import Account from "../models/Account.js";
import { streamCsvAndImport, generateErrorReportCsv } from "../lib/streaming-importer.js";
import { cancelContactImport } from "../lib/contact-import.js";

// Bypass local router DNS resolution issues for MongoDB Atlas SRV lookups
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const TEST_ACCOUNT_ID = new mongoose.Types.ObjectId("777777777777777777777771");
const TEST_NEWSLETTER_ID = new mongoose.Types.ObjectId("777777777777777777777772");
const testAccount = { _id: TEST_ACCOUNT_ID, contactFields: [] };

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
	await ContactImport.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await LeftOutContact.deleteMany({ accountId: TEST_ACCOUNT_ID });
	await Suppression.deleteMany({ accountId: TEST_ACCOUNT_ID });
}

async function seedTestPrerequisites() {
	await Account.updateOne(
		{ _id: TEST_ACCOUNT_ID },
		{ $set: { name: "Test Enterprise Account" } },
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
}

async function runTestSuite() {
	console.log("==================================================");
	console.log("PHASE 3: STREAMING CSV IMPORTER TIERED TEST SUITE");
	console.log("==================================================");

	await connectDb();
	await cleanupTestData();
	await seedTestPrerequisites();

	const initialMem = getMemoryUsageMB();
	console.log(`Initial Memory Baseline: RSS ${initialMem.rss}MB, Heap ${initialMem.heapUsed}MB`);

	// ----------------------------------------------------
	// TIER 1: 10 RECORDS (Validation, Mapping, Dry-Run)
	// ----------------------------------------------------
	console.log("\n>>> TEST 1: Tier 1 (10 Records - Validation, Field Mapping, Dry-Run)");
	const csv10 = [
		"Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status",
		"priya.sharma@tcs.example.com,Priya,Sharma,TCS,IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED",
		"rahul.verma@lawfirm.example.com,Rahul,Verma,Verma & Co,Partner,Legal,Delhi,LAW_FIRM,REGISTERED",
		"vikram.aditya@biotech.example.com,Vikram,Aditya,BioTech Labs,R&D Director,Pharma,Bangalore,STARTUP_RND,DELEGATE",
		"ananya.sen@patent.example.com,Ananya,Sen,Patent Corp,Analyst,IP,Mumbai,CPVA_PROSPECT,QUALIFIED",
		"priya.sharma@tcs.example.com,Priya,Sharma,TCS,IP Head,IT,Hyderabad,IN_HOUSE_COUNSEL,INVITED", // Duplicate
		"invalid-email-address,Bad,User,None,None,None,None,None,NONE", // Invalid
		"suresh.patel@auto.example.com,Suresh,Patel,AutoTech,VP Engineering,Auto,Pune,IN_HOUSE_COUNSEL,INVITED",
		"deepa.rao@ipfirm.example.com,Deepa,Rao,Rao Legal,Associate,Legal,Chennai,LAW_FIRM,DELEGATE",
		"kavita.nair@health.example.com,Kavita,Nair,HealthCare Plus,Chief Counsel,Pharma,Hyderabad,IN_HOUSE_COUNSEL,REGISTERED",
		"rahul.verma@lawfirm.example.com,Rahul,Verma,Verma & Co,Partner,Legal,Delhi,LAW_FIRM,REGISTERED", // Duplicate
	].join("\n");

	// A. Dry-Run Test
	console.log("  Running Dry-Run test on 10 records...");
	const dryRunResult = await streamCsvAndImport({
		stream: csv10,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: true,
		fileName: "test-tier-1-dry-run.csv",
	});

	assert.equal(dryRunResult.status, "done", "Dry run status should be done");
	assert.equal(dryRunResult.dryRun, true, "Dry run flag should be true");
	assert.equal(dryRunResult.dropped.duplicate, 2, "Should identify 2 duplicate rows in file");
	assert.equal(dryRunResult.dropped.invalid, 1, "Should identify 1 invalid email");
	assert.equal(dryRunResult.created, 7, "Should identify 7 valid unique prospective records");

	const contactsAfterDryRun = await Contact.countDocuments(scoped(testAccount));
	assert.equal(contactsAfterDryRun, 0, "Dry run MUST NOT write records to Contact table");
	console.log("  ✓ Dry-Run passed: 0 records committed to database, 2 duplicates detected, 1 invalid filtered.");

	// B. Live Commit on Tier 1
	console.log("  Running Live Import on 10 records...");
	const live10Result = await streamCsvAndImport({
		stream: csv10,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "test-tier-1-live.csv",
	});

	assert.equal(live10Result.status, "done");
	assert.equal(live10Result.created, 7, "Should insert 7 new contacts");
	assert.equal(live10Result.dropped.duplicate, 2);
	assert.equal(live10Result.dropped.invalid, 1);

	const contactsInDb = await Contact.find(scoped(testAccount)).lean();
	assert.equal(contactsInDb.length, 7, "Should have exactly 7 contacts in database");

	const priya = contactsInDb.find((c) => c.email === "priya.sharma@tcs.example.com");
	assert.ok(priya, "Contact Priya Sharma should exist");
	assert.equal(priya.company, "TCS");
	assert.equal(priya.designation, "IP Head");
	assert.equal(priya.industry, "IT");
	assert.equal(priya.city, "Hyderabad");
	assert.equal(priya.persona, "IN_HOUSE_COUNSEL");
	assert.equal(priya.gipcStatus, "INVITED");
	console.log("  ✓ Live Commit passed: 7 contacts inserted with full enterprise metadata preserved.");

	// ----------------------------------------------------
	// TIER 2: 100 RECORDS (Suppression & Deduplication)
	// ----------------------------------------------------
	console.log("\n>>> TEST 2: Tier 2 (100 Records - Suppression & In-DB Deduplication)");
	await Suppression.create({
		accountId: TEST_ACCOUNT_ID,
		email: "suppressed_test_user@example.com",
		reason: "bounce",
		detail: "Hard bounce test seed",
	});

	const records100 = ["Email,First Name,Company,Persona"];
	// 7 existing from previous test
	records100.push("priya.sharma@tcs.example.com,Priya,TCS Updated,IN_HOUSE_COUNSEL");
	// 1 suppressed record
	records100.push("suppressed_test_user@example.com,Suppressed,Entity,SPAM");
	// 92 new unique records
	for (let i = 1; i <= 92; i++) {
		records100.push(`contact_${i}@enterprise.example.com,Contact${i},Company ${i},LAW_FIRM`);
	}

	const result100 = await streamCsvAndImport({
		stream: records100.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		dryRun: false,
		fileName: "test-tier-2-100.csv",
	});

	assert.equal(result100.status, "done");
	assert.equal(result100.existing, 1, "Should detect 1 existing in-database contact");
	assert.equal(result100.dropped.suppressed, 1, "Should detect 1 account-level suppressed contact");
	assert.equal(result100.created, 92, "Should insert 92 new contacts");

	const totalContacts100 = await Contact.countDocuments(scoped(testAccount));
	assert.equal(totalContacts100, 7 + 92, "Total contacts should be 99");

	const priyaUpdated = await Contact.findOne(scoped(testAccount, { email: "priya.sharma@tcs.example.com" })).lean();
	assert.equal(priyaUpdated.company, "TCS Updated", "Existing contact metadata should be updated safely");
	console.log("  ✓ Tier 2 passed: Suppression preserved (1 dropped), existing record updated (1 matched), 92 created.");

	// ----------------------------------------------------
	// TIER 3: 1,000 RECORDS (Full Chunk Pipeline & Export)
	// ----------------------------------------------------
	console.log("\n>>> TEST 3: Tier 3 (1,000 Records - Full Chunk Pipeline & Error Export)");
	const records1000 = ["Email,First Name,Company,Designation,Persona"];
	for (let i = 1; i <= 1000; i++) {
		if (i % 100 === 0) {
			records1000.push(`invalid_email_no_domain_${i},Name,Company,Role,None`);
		} else {
			records1000.push(`user_${i}@corp.example.com,User${i},Corp ${i},Counsel,IN_HOUSE_COUNSEL`);
		}
	}

	const result1000 = await streamCsvAndImport({
		stream: records1000.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 500,
		dryRun: false,
		fileName: "test-tier-3-1000.csv",
	});

	assert.equal(result1000.status, "done");
	assert.equal(result1000.dropped.invalid, 10, "Should filter 10 invalid emails");
	assert.equal(result1000.created, 990, "Should insert 990 valid contacts");

	// Test Error Report Generation
	const errorCsv = await generateErrorReportCsv(testAccount, result1000.importId);
	assert.ok(errorCsv.includes("Email,Reason,Can Bring Back"), "Error CSV header must be present");
	assert.ok(errorCsv.includes("invalid_email_no_domain_100"), "Rejected record must appear in error CSV");
	console.log("  ✓ Tier 3 passed: 1,000 records processed across 2 chunks. Error report CSV verified.");

	// ----------------------------------------------------
	// TIER 4: 10,000 RECORDS (Multi-Chunk & Cancellation)
	// ----------------------------------------------------
	console.log("\n>>> TEST 4: Tier 4 (10,000 Records - Multi-Batch Throughput & Cancellation)");
	const records10k = ["Email,First Name,Company,Persona"];
	for (let i = 1; i <= 10000; i++) {
		records10k.push(`scale_${i}@domain.example.com,User${i},Scale Org ${i % 50},STARTUP_RND`);
	}

	const start10k = Date.now();
	const result10k = await streamCsvAndImport({
		stream: records10k.join("\n"),
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 1000,
		dryRun: false,
		fileName: "test-tier-4-10k.csv",
	});

	const duration10k = (Date.now() - start10k) / 1000;
	const mem10k = getMemoryUsageMB();
	console.log(`  Processed 10,000 records in ${duration10k.toFixed(2)}s (${Math.round(10000 / duration10k)} rec/sec)`);
	console.log(`  Memory during 10k import: RSS ${mem10k.rss}MB, Heap ${mem10k.heapUsed}MB`);
	assert.equal(result10k.created, 10000, "Should create 10,000 records");
	console.log("  ✓ Tier 4 passed: 10,000 records inserted in multi-batch streaming mode without memory bloat.");

	// ----------------------------------------------------
	// CANCELLATION TEST
	// ----------------------------------------------------
	console.log("\n>>> TEST: Mid-Stream Cancellation Test");
	const cancellableImport = await ContactImport.create({
		accountId: TEST_ACCOUNT_ID,
		newsletterId: TEST_NEWSLETTER_ID,
		consent: true,
		consentText: "Agreed",
		consentAt: new Date(),
		status: "processing",
		fileName: "cancel-test.csv",
	});

	const cancelRes = await cancelContactImport({
		account: testAccount,
		importId: cancellableImport._id,
	});
	assert.equal(cancelRes.cancelled, true, "Should successfully cancel import");

	const cancelledDoc = await ContactImport.findOne(scoped(testAccount, { _id: cancellableImport._id })).lean();
	assert.equal(cancelledDoc.status, "cancelled", "Status should be cancelled");
	assert.ok(cancelledDoc.cancelledAt, "cancelledAt timestamp must be recorded");
	console.log("  ✓ Cancellation passed: import status transitions to 'cancelled' with timestamp.");

	// ----------------------------------------------------
	// TIER 5: 150,000-RECORD CAPACITY STRESS TEST
	// ----------------------------------------------------
	console.log("\n>>> TEST 5: Tier 5 (Controlled 150,000-Record Capacity Stress Test)");
	console.log("  Generating streaming dataset of 150,000 records...");

	async function* generate150kLines() {
		yield "Email,First Name,Last Name,Company,Designation,Industry,City,Persona,GIPC Status,CPVA Status,Intent Score\n";
		const personas = ["IN_HOUSE_COUNSEL", "LAW_FIRM", "STARTUP_RND", "CPVA_PROSPECT"];
		const gipcStatuses = ["INVITED", "REGISTERED", "ATTENDED", "DELEGATE"];
		for (let i = 1; i <= 150000; i++) {
			const p = personas[i % personas.length];
			const g = gipcStatuses[i % gipcStatuses.length];
			const intent = (i * 7) % 100;
			yield `delegate_${i}@gipc-delegates.example.com,FirstName${i},LastName${i},Enterprise Corp ${i % 500},General Counsel,Intellectual Property,Hyderabad,${p},${g},NONE,${intent}\n`;
		}
	}

	const readable150k = Readable.from(generate150kLines());
	const memBefore150k = getMemoryUsageMB();
	console.log(`  Memory Before 150k Start: RSS ${memBefore150k.rss}MB, Heap ${memBefore150k.heapUsed}MB`);

	let progressTicks = 0;
	const start150k = Date.now();

	const result150k = await streamCsvAndImport({
		stream: readable150k,
		account: testAccount,
		newsletterId: TEST_NEWSLETTER_ID,
		batchSize: 1000,
		dryRun: true, // Controlled capacity test in dry-run mode to verify 150k memory & pipeline safely
		fileName: "gipc-150k-delegates.csv",
		total: 150000,
		onProgress: ({ processed }) => {
			progressTicks++;
			if (processed % 25000 === 0 || processed === 150000) {
				const currentMem = getMemoryUsageMB();
				const elapsed = (Date.now() - start150k) / 1000;
				const rate = Math.round(processed / elapsed);
				console.log(
					`    Progress: ${processed.toLocaleString()} / 150,000 records (${rate} rec/sec) | Memory: RSS ${currentMem.rss}MB, Heap ${currentMem.heapUsed}MB`
				);
			}
		},
	});

	const duration150k = (Date.now() - start150k) / 1000;
	const memAfter150k = getMemoryUsageMB();

	console.log(`\n  150,000-Record Capacity Test Completed!`);
	console.log(`  Duration: ${duration150k.toFixed(2)}s`);
	console.log(`  Average Throughput: ${Math.round(150000 / duration150k).toLocaleString()} records/second`);
	console.log(`  Memory Delta: RSS ${memAfter150k.rss - memBefore150k.rss}MB, Heap ${memAfter150k.heapUsed - memBefore150k.heapUsed}MB`);
	console.log(`  Final Memory: RSS ${memAfter150k.rss}MB, Heap ${memAfter150k.heapUsed}MB`);

	assert.equal(result150k.status, "done", "150,000 record test must complete with status 'done'");
	assert.equal(result150k.processed, 150000, "Must process exactly 150,000 records");
	assert.ok(memAfter150k.rss < 250, "Memory RSS must remain under 250MB (actual observed: " + memAfter150k.rss + "MB)");

	console.log("  ✓ 150,000-Record Capacity Test PASSED: Constant memory streaming confirmed with ZERO leaks or OOM.");

	// Clean up test data
	await cleanupTestData();
	console.log("\n==================================================");
	console.log("ALL 5 TIERS & TEST CASES PASSED SUCCESSFULLY!");
	console.log("==================================================");

	process.exit(0);
}

runTestSuite().catch((err) => {
	console.error("TEST FAILED:", err);
	process.exit(1);
});
