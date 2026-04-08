import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MIME_TYPES: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
	gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
	tif: "image/tiff", tiff: "image/tiff",
};

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const text = event.text ?? "";

		// Log full raw text as JSON so we see exact chars (escapes, newlines, etc.)
		ctx.ui.notify(`[img-debug] RAW: ${JSON.stringify(text)}`, "info");

		// Test several regex approaches directly
		const r1 = /\/[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?)/gi;
		const r2 = /\/\S+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?)/gi;
		const r3 = /.+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?)/gi;

		ctx.ui.notify(`[img-debug] r1=${JSON.stringify(text.match(r1))}`, "info");
		ctx.ui.notify(`[img-debug] r2=${JSON.stringify(text.match(r2))}`, "info");
		ctx.ui.notify(`[img-debug] r3=${JSON.stringify(text.match(r3))}`, "info");

		return { action: "continue" };
	});
}
