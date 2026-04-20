import * as https from "node:https";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ModelResponse {
	model: string;
	content: string;
	error?: string;
}

function httpsPost(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const req = https.request(
			{
				hostname: parsed.hostname,
				path: parsed.pathname,
				method: "POST",
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
				res.on("error", reject);
			},
		);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

export async function queryModel(
	model: string,
	prompt: string,
	apiKey: string,
	timeoutMs: number,
): Promise<ModelResponse> {
	const body = JSON.stringify({
		model,
		messages: [{ role: "user", content: prompt }],
	});

	try {
		const raw = await httpsPost(
			OPENROUTER_URL,
			body,
			{ Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://github.com/pi-tools", "X-Title": "pi-council" },
			timeoutMs * 1000,
		);

		const json = JSON.parse(raw) as {
			choices?: Array<{ message?: { content?: string } }>;
			error?: { message?: string };
		};

		if (json.error) {
			return { model, content: "", error: json.error.message ?? "Unknown API error" };
		}

		const content = json.choices?.[0]?.message?.content ?? "";
		return { model, content };
	} catch (err) {
		return { model, content: "", error: err instanceof Error ? err.message : String(err) };
	}
}

export async function queryModelsParallel(
	models: string[],
	prompt: string,
	apiKey: string,
	timeoutMs: number,
): Promise<ModelResponse[]> {
	return Promise.all(models.map((m) => queryModel(m, prompt, apiKey, timeoutMs)));
}
