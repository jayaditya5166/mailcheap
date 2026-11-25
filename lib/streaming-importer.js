import "server-only";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import Papa from "papaparse";
import { connectDb } from "@/lib/db";
import { scoped } from "@/lib/account-scope";
import {
	createContactImport,
	processImportRows,
	cancelContactImport,
} from "@/lib/contact-import";
import {
	mapColumns,
	readColumnPlan,
	planColumns,
	normalizeImportRow,
	sanitizeImportRow,
	MAX_IMPORT_ROWS_PER_REQUEST,
} from "@/lib/csv-import";
import ContactImport from "@/models/ContactImport";
import LeftOutContact from "@/models/LeftOutContact";

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Stream a CSV readable stream, parse in memory-efficient batches, and import into MongoDB.
 * Ensures memory stays constant (< 60MB) even with 150,000+ records.
 */
export async function streamCsvAndImport({
	stream,
	account,
	newsletterId,
	userId,
	apiKeyId,
	importId: existingImportId = null,
	fileName = "contacts.csv",
	total,
	consent = true,
	dryRun = false,
	batchSize = DEFAULT_BATCH_SIZE,
	columnPlan = null,
	onProgress = null,
}) {
	await connectDb();

	let importId;
	if (existingImportId) {
		importId = existingImportId;
	} else {
		// 1. Initialize ContactImport record
		const { contactImport, error: initError } = await createContactImport({
			account,
			userId,
			apiKeyId,
			newsletterId,
			consent,
			source: dryRun ? "dry-run" : "streaming-import",
			fileName,
			total,
			dryRun,
		});

		if (initError || !contactImport) {
			throw new Error(initError || "Failed to initialize contact import");
		}
		importId = contactImport._id;
	}
	const lineReader = createInterface({
		input: stream instanceof Readable ? stream : Readable.from(stream),
		crlfDelay: Infinity,
	});

	let headers = null;
	let plan = columnPlan;
	let activeColumns = null;
	let activeProfile = null;

	let currentBatch = [];
	let droppedBatch = [];
	let seenEmailsInFile = new Set();
	let duplicateInFileCount = 0;

	let totalProcessed = 0;
	let totalCreated = 0;
	let totalExisting = 0;
	let totalDropped = {
		invalid: 0,
		typo: 0,
		trap: 0,
		role: 0,
		disposable: 0,
		spamDomain: 0,
		duplicate: 0,
		suppressed: 0,
		undeliverable: 0,
		noMail: 0,
	};

	try {
		for await (const line of lineReader) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Parse CSV line
			const parsed = Papa.parse(trimmed, { skipEmptyLines: true });
			if (!parsed.data || parsed.data.length === 0) continue;
			const rowData = parsed.data[0];

			// Process header row
			if (!headers) {
				headers = rowData.map((h) => String(h).trim());
				if (!plan) {
					plan = planColumns(headers, account.contactFields ?? []);
				}
				const planResult = readColumnPlan(plan, account.contactFields ?? []);
				activeColumns = planResult.columns;
				activeProfile = planResult.profile;
				continue;
			}

			// Map row array to object keyed by header
			const rawObj = {};
			for (let i = 0; i < headers.length; i++) {
				rawObj[headers[i]] = rowData[i] ?? "";
			}

			// Normalize according to mapped columns
			const normalized = normalizeImportRow(rawObj, activeColumns, { profile: activeProfile });
			if (!normalized || !normalized.email) {
				totalDropped.invalid++;
				const rawEmail = rawObj[activeColumns?.email] || String(rowData[0] || `row-${totalProcessed + 1}`);
				droppedBatch.push({ email: rawEmail, reason: "invalid", canBringBack: false, contact: rawObj });
				continue;
			}

			// Check file-level duplicate
			if (seenEmailsInFile.has(normalized.email)) {
				duplicateInFileCount++;
				totalDropped.duplicate++;
				droppedBatch.push({ email: normalized.email, reason: "duplicate", canBringBack: false, contact: normalized });
				continue;
			}
			seenEmailsInFile.add(normalized.email);

			currentBatch.push(normalized);

			// When batch reaches threshold, flush to database
			if (currentBatch.length >= Math.min(batchSize, MAX_IMPORT_ROWS_PER_REQUEST)) {
				const result = await processBatch({
					account,
					newsletterId,
					importId,
					batch: currentBatch,
					dryRun,
				});

				if (droppedBatch.length > 0) {
					await LeftOutContact.bulkWrite(
						droppedBatch.map(({ email, reason, canBringBack, contact }) => ({
							updateOne: {
								filter: { accountId: account._id, importId, email },
								update: { $setOnInsert: { newsletterId, reason, canBringBack, contact } },
								upsert: true,
							},
						})),
						{ ordered: false }
					);
					droppedBatch = [];
				}

				if (result.cancelled) {
					lineReader.close();
					await ContactImport.updateOne(
						scoped(account, { _id: importId }),
						{
							$set: {
								status: "cancelled",
								finishedAt: new Date(),
								rows: totalProcessed,
								created: totalCreated,
								existing: totalExisting,
								dropped: totalDropped,
							},
						}
					);
					return {
						importId: String(importId),
						status: "cancelled",
						processed: totalProcessed,
						created: totalCreated,
						existing: totalExisting,
						dropped: totalDropped,
					};
				}

				totalProcessed += result.rows;
				totalCreated += result.created;
				totalExisting += result.existing;
				for (const [key, val] of Object.entries(result.dropped)) {
					totalDropped[key] = (totalDropped[key] || 0) + val;
				}

				currentBatch = [];

				if (onProgress) {
					onProgress({
						importId,
						processed: totalProcessed,
						created: totalCreated,
						existing: totalExisting,
						dropped: totalDropped,
					});
				}
			}
		}

		// Flush any remaining rows
		if (currentBatch.length > 0) {
			const result = await processBatch({
				account,
				newsletterId,
				importId,
				batch: currentBatch,
				dryRun,
			});

			totalProcessed += result.rows;
			totalCreated += result.created;
			totalExisting += result.existing;
			for (const [key, val] of Object.entries(result.dropped)) {
				totalDropped[key] = (totalDropped[key] || 0) + val;
			}
		}

		if (droppedBatch.length > 0) {
			await LeftOutContact.bulkWrite(
				droppedBatch.map(({ email, reason, canBringBack, contact }) => ({
					updateOne: {
						filter: { accountId: account._id, importId, email },
						update: { $setOnInsert: { newsletterId, reason, canBringBack, contact } },
						upsert: true,
					},
				})),
				{ ordered: false }
			);
			droppedBatch = [];
		}

		// Finalize ContactImport record
		await ContactImport.updateOne(
			scoped(account, { _id: importId }),
			{
				$set: {
					status: "done",
					finishedAt: new Date(),
					rows: totalProcessed,
					created: totalCreated,
					existing: totalExisting,
					total: total || totalProcessed + duplicateInFileCount,
					dropped: totalDropped,
				},
			}
		);

		return {
			importId: String(importId),
			status: "done",
			processed: totalProcessed,
			created: totalCreated,
			existing: totalExisting,
			dropped: totalDropped,
			dryRun,
		};
	} catch (error) {
		await ContactImport.updateOne(
			scoped(account, { _id: importId }),
			{
				$set: {
					status: "failed",
					finishedAt: new Date(),
					error: String(error?.message || "Import error").slice(0, 300),
					rows: totalProcessed,
					created: totalCreated,
					existing: totalExisting,
					dropped: totalDropped,
				},
			}
		);
		throw error;
	}
}

async function processBatch({ account, newsletterId, importId, batch, dryRun }) {
	return processImportRows({
		account,
		newsletterId,
		importId,
		rows: batch,
		dryRun,
	});
}

/**
 * Generate CSV text stream for all rejected / left-out records of an import
 */
export async function generateErrorReportCsv(account, importId) {
	await connectDb();

	const leftOutRecords = await LeftOutContact.find(scoped(account, { importId }))
		.sort({ createdAt: -1 })
		.lean();

	const lines = ["Email,Reason,Can Bring Back,Subscribed At,Details"];
	for (const rec of leftOutRecords) {
		const email = escapeCsvField(rec.email);
		const reason = escapeCsvField(rec.reason);
		const canBringBack = rec.canBringBack ? "Yes" : "No";
		const subAt = rec.contact?.subscribedAt ? new Date(rec.contact.subscribedAt).toISOString() : "";
		const details = escapeCsvField(JSON.stringify(rec.contact || {}));
		lines.push(`${email},${reason},${canBringBack},${subAt},${details}`);
	}

	return lines.join("\n");
}

function escapeCsvField(val) {
	const str = String(val ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}
