/**
 * image-label extension
 *
 * When the user drags a screenshot into pi, macOS inserts a temp path like:
 *   /var/folders/mm/.../Screenshot 2026-04-07 at 8.15.29 PM.png
 *
 * This extension replaces those paths with [Image 1], [Image 2]... labels
 * and loads the actual image data from disk.
 */
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

// Match any path from / to an image extension — allows spaces, backslashes, anything except newline
const PATH_RE = /(\/[^\n]*?\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?))(?:\s|$)/gi;

function extractImagePaths(text: string): string[] {
	const paths: string[] = [];
	PATH_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PATH_RE.exec(text)) !== null) {
		// Unescape shell-escaped chars (e.g. "\ " → " ")
		const p = m[1].replace(/\\(.)/g, "$1").trim();
		if (!paths.includes(p)) paths.push(p);
	}
	return paths;
}

function readImageAsBase64(filePath: string): { type: "image"; data: string; mimeType: string } | null {
	try {
		const data = fs.readFileSync(filePath);
		return { type: "image", data: data.toString("base64"), mimeType: getMimeType(filePath) };
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const text = event.text ?? "";
		const existingImages = event.images ?? [];

		const foundPaths = extractImagePaths(text);

		// DEBUG
		ctx.ui.notify(`[image-label] foundPaths=${JSON.stringify(foundPaths)}`, "info");

		if (foundPaths.length === 0) return { action: "continue" };

		// Load images from disk
		const loadedImages: { type: "image"; data: string; mimeType: string }[] = [];
		for (const p of foundPaths) {
			const img = readImageAsBase64(p);
			if (img) {
				loadedImages.push(img);
			} else {
				ctx.ui.notify(`[image-label] could not read: ${p}`, "warning");
			}
		}

		const allImages = [...existingImages, ...loadedImages];

		// Replace paths in text with [Image N] labels
		let cleanedText = text;
		let index = existingImages.length;
		for (const p of foundPaths) {
			index++;
			const label = `[Image ${index}]`;
			const escapedForRegex = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const shellEscaped = p.replace(/ /g, "\\ ").replace(/[.*+?^${}()|[\]]/g, "\\$&");
			cleanedText = cleanedText
				.replace(new RegExp(shellEscaped, "g"), label)
				.replace(new RegExp(escapedForRegex, "g"), label);
		}

		const finalText = cleanedText.trim() || foundPaths.map((_, i) => `[Image ${i + 1}]`).join(" ");

		return { action: "transform", text: finalText, images: allImages };
	});
}
