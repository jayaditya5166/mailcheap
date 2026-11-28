import mongoose from "mongoose";
import { isSendingEnabled as envSendingEnabled } from "./config.js";

// Cached state across requests in the same lambda
let memorySendingState = null;

export async function isSendingAllowed(account = null) {
	if (memorySendingState !== null) {
		return memorySendingState;
	}

	if (globalThis.__SENDING_ENABLED_OVERRIDE !== undefined) {
		return Boolean(globalThis.__SENDING_ENABLED_OVERRIDE);
	}

	// 1. Check account if provided
	if (account && typeof account.sendingEnabled === "boolean") {
		memorySendingState = account.sendingEnabled;
		globalThis.__SENDING_ENABLED_OVERRIDE = account.sendingEnabled;
		process.env.SENDING_ENABLED = account.sendingEnabled ? "true" : "false";
		return account.sendingEnabled;
	}

	// 2. Check MongoDB serversettings
	try {
		if (mongoose.connection?.readyState === 1) {
			const setting = await mongoose.connection.db.collection("serversettings").findOne({ key: "sending_enabled" });
			if (setting && typeof setting.value === "boolean") {
				memorySendingState = setting.value;
				globalThis.__SENDING_ENABLED_OVERRIDE = setting.value;
				process.env.SENDING_ENABLED = setting.value ? "true" : "false";
				return setting.value;
			}
		}
	} catch {
		// Ignore database query failure and fall back to environment
	}

	const fromEnv = envSendingEnabled();
	return fromEnv;
}

export async function setSendingAllowed(enabled, accountId = null) {
	const boolVal = Boolean(enabled);
	memorySendingState = boolVal;
	globalThis.__SENDING_ENABLED_OVERRIDE = boolVal;
	process.env.SENDING_ENABLED = boolVal ? "true" : "false";

	try {
		if (mongoose.connection?.readyState === 1) {
			await mongoose.connection.db.collection("serversettings").updateOne(
				{ key: "sending_enabled" },
				{ $set: { key: "sending_enabled", value: boolVal, updatedAt: new Date() } },
				{ upsert: true }
			);

			if (accountId) {
				await mongoose.connection.db.collection("accounts").updateOne(
					{ _id: new mongoose.Types.ObjectId(accountId) },
					{ $set: { sendingEnabled: boolVal } }
				);
			} else {
				await mongoose.connection.db.collection("accounts").updateMany(
					{},
					{ $set: { sendingEnabled: boolVal } }
				);
			}
		}
	} catch (error) {
		console.error("Failed to update sending setting in database:", error);
	}

	return boolVal;
}
