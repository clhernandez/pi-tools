/**
 * image-label extension
 *
 * Detects image paths dragged into the editor and immediately replaces them
 * with [Image N] labels. Loads image data from disk for LLM attachment.
 *
 * Key insight: dragged files arrive as ONE large data chunk (the full path),
 * while normal keystrokes are always 1-4 chars. We use length as a heuristic.
 */
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MIME_TYPES: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
	gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
	tif: "image/tiff", tiff: "image/tiff",
};

function getMimeType(p: string): string {
	const ext = p.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[ext] ?? "image/png";
}

const IMAGE_PATH_RE = /(\/[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?))/gi;

export default function (pi: ExtensionAPI) {
	const pendingImages: { type: "image"; data: string; mimeType: string }[] = [];
	let settingEditor = false;

	pi.on("session_start", (_event, ctx) => {
		pendingImages.length = 0;

		ctx.ui.onTerminalInput((data) => {
			// Skip if we triggered this ourselves via setEditorText
			if (settingEditor) return undefined;

			// Strip bracketed paste markers if present (ESC[200~ ... ESC[201~)
			// They may appear as literal chars or escape sequences
			const cleaned = data
				.replace(/\x1b\[200~/g, "")
				.replace(/\x1b\[201~/g, "")
				.replace(/\[200~/g, "")
				.replace(/\[201~/g, "");

			// Only process if this looks like a path (starts with /, longer than a normal keystroke)
			if (!cleaned.includes("/") || cleaned.length < 10) return undefined;

			IMAGE_PATH_RE.lastIndex = 0;
			const rawMatches = [...cleaned.matchAll(IMAGE_PATH_RE)].map(m => m[1]);
			if (rawMatches.length === 0) return undefined;

			const images: { type: "image"; data: string; mimeType: string }[] = [];
			let cleanedText = cleaned;
			let index = 0;

			for (const raw of rawMatches) {
				const realPath = raw.replace(/\\(.)/g, "$1").trim();
				try {
					const fileData = fs.readFileSync(realPath);
					images.push({ type: "image", data: fileData.toString("base64"), mimeType: getMimeType(realPath) });
					index++;
					const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					cleanedText = cleanedText.replace(new RegExp(escaped, "g"), `[Image ${index}]`);
				} catch {
					// Can't read — leave path as-is
				}
			}

			if (images.length === 0) return undefined;

			// Replace editor content
			const currentText = ctx.ui.getEditorText();
			const prefix = currentText ? currentText + " " : "";
			settingEditor = true;
			ctx.ui.setEditorText((prefix + cleanedText.trim()).trim());
			settingEditor = false;

			pendingImages.length = 0;
			pendingImages.push(...images);

			return { consume: true };
		});
	});

	pi.on("input", async (event, _ctx) => {
		if (event.source === "extension") return { action: "continue" };
		if (pendingImages.length === 0) return { action: "continue" };
		const images = [...(event.images ?? []), ...pendingImages];
		pendingImages.length = 0;
		return { action: "transform", text: event.text, images };
	});
}
