/**
 * image-label extension
 *
 * When the user drags/pastes a screenshot into the terminal, macOS expands it
 * as a long temp path like:
 *   /var/folders/mm/.../Screenshot 2026-04-07 at 8.15.29 PM.png
 *
 * This extension detects that pattern and replaces the text with a clean
 * "[Image 1]", "[Image 2]", ... label — matching how Claude Code renders
 * pasted images, while preserving the actual image data in event.images.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Matches a bare file path to an image (no surrounding text, just the path)
const IMAGE_PATH_RE = /^\s*(\/[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?)(?:\s+\/[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?))*)\s*$/i;

// Matches individual image paths within a multi-path string
const SINGLE_PATH_RE = /\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?)/gi;

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, _ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const text = event.text ?? "";
		const images = event.images ?? [];

		// Case 1: text is only image path(s), no other content
		if (IMAGE_PATH_RE.test(text)) {
			const paths = text.match(SINGLE_PATH_RE) ?? [];
			const count = Math.max(paths.length, images.length, 1);
			const labels = Array.from({ length: count }, (_, i) => `[Image ${i + 1}]`).join(" ");
			return { action: "transform", text: labels, images };
		}

		// Case 2: text has image paths embedded among other text
		// Replace each path with [Image N]
		if (images.length > 0 && SINGLE_PATH_RE.test(text)) {
			let index = 0;
			SINGLE_PATH_RE.lastIndex = 0;
			const cleaned = text.replace(SINGLE_PATH_RE, () => `[Image ${++index}]`).trim();
			return { action: "transform", text: cleaned, images };
		}

		return { action: "continue" };
	});
}
