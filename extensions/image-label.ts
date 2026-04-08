/**
 * image-label extension
 *
 * When the user drags/pastes a screenshot into the terminal, macOS expands it
 * as a long temp path like:
 *   /var/folders/mm/.../Screenshot 2026-04-07 at 8.15.29 PM.png
 *
 * This extension:
 * 1. Detects image paths in the input text
 * 2. Reads the image files from disk and injects them as proper image attachments
 * 3. Replaces the paths with clean [Image 1], [Image 2], ... labels
 *
 * Works both when paths are the entire input and when mixed with text.
 */
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|tiff?)$/i;

const MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
};

function getMimeType(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[ext] ?? "image/png";
}

// Match file paths — handles backslash-escaped chars (shell style: /path/to/file\ name.png)
// and unescaped paths
function extractImagePaths(text: string): string[] {
	const paths: string[] = [];

	// Each token starts with / and consists of non-whitespace chars or backslash-escaped chars
	const re = /(?:^|\s)(\/(?:[^\s\\]|\\.)+)/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		// Unescape all backslash escapes (e.g. "\ " → " ")
		const p = match[1].replace(/\\(.)/g, "$1");
		if (IMAGE_EXTENSIONS.test(p) && fs.existsSync(p)) {
			paths.push(p);
		}
	}

	return paths;
}

function readImageAsBase64(filePath: string): { data: string; mimeType: string } | null {
	try {
		const data = fs.readFileSync(filePath);
		return {
			data: data.toString("base64"),
			mimeType: getMimeType(filePath),
		};
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		// DEBUG — remove after diagnosing
		ctx.ui.notify(
			`[image-label] text=${JSON.stringify(event.text?.slice(0, 100))} images=${event.images?.length ?? 0}`,
			"info",
		);

		const text = event.text ?? "";
		const existingImages = event.images ?? [];

		// Extract image paths from the text
		const foundPaths = extractImagePaths(text);

		ctx.ui.notify(`[image-label] foundPaths=${JSON.stringify(foundPaths)}`, "info");

		if (foundPaths.length === 0) return { action: "continue" };

		// Read images from disk
		const loadedImages: { type: "image"; data: string; mimeType: string }[] = [];
		for (const p of foundPaths) {
			const img = readImageAsBase64(p);
			if (img) loadedImages.push({ type: "image", ...img });
		}

		// Combine with any already-attached images
		const allImages = [...existingImages, ...loadedImages];

		// Replace each path in the text with [Image N]
		let index = existingImages.length;
		let cleanedText = text;
		for (const p of foundPaths) {
			index++;
			// Match both the unescaped path and the shell-escaped variant
			const escapedUnescaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const escapedShell = p.replace(/ /g, "\\ ").replace(/[.*+?^${}()|[\]]/g, "\\$&");
			const re = new RegExp(`(?:${escapedShell}|${escapedUnescaped})`, "g");
			cleanedText = cleanedText.replace(re, `[Image ${index}]`);
		}

		const finalText = cleanedText.trim() || foundPaths.map((_, i) => `[Image ${i + 1}]`).join(" ");

		return { action: "transform", text: finalText, images: allImages };
	});
}
