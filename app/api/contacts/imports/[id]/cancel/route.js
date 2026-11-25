import { cancelContactImport } from "@/lib/contact-import";
import { connectDb } from "@/lib/db";
import { requireAccount } from "@/lib/auth";

export async function POST(request, { params }) {
	try {
		await connectDb();
		const account = await requireAccount();
		const { id } = await params;

		const result = await cancelContactImport({ account, importId: id });
		if (result.error) {
			return Response.json({ error: result.error }, { status: 400 });
		}

		return Response.json({ success: true, cancelled: true, importId: id });
	} catch (error) {
		return Response.json({ error: error.message || "Failed to cancel import" }, { status: 500 });
	}
}
