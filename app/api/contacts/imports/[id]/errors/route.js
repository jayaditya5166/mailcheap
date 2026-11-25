import { generateErrorReportCsv } from "@/lib/streaming-importer";
import { connectDb } from "@/lib/db";
import { requireAccount } from "@/lib/auth";

export async function GET(request, { params }) {
	try {
		await connectDb();
		const account = await requireAccount();
		const { id } = await params;

		const csvContent = await generateErrorReportCsv(account, id);
		const date = new Date().toISOString().slice(0, 10);

		return new Response(csvContent, {
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": `attachment; filename="import-errors-${id}-${date}.csv"`,
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		return Response.json({ error: error.message || "Failed to generate error report" }, { status: 500 });
	}
}
