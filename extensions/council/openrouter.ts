import { complete, getModel } from "@mariozechner/pi-ai";

export interface ModelResponse {
	model: string;
	content: string;
	error?: string;
}

export async function queryModel(
	modelId: string,
	prompt: string,
	_apiKey: string,
	timeoutSecs: number,
	getApiKeyAndHeaders: (model: object) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>,
): Promise<ModelResponse> {
	const [provider, ...rest] = modelId.split("/");
	const id = rest.join("/");

	const model = getModel(provider, id);
	if (!model) {
		return { model: modelId, content: "", error: `Model not found in pi registry: ${modelId}` };
	}

	const auth = await getApiKeyAndHeaders(model);
	if (!auth.ok) {
		return { model: modelId, content: "", error: auth.error ?? "Auth failed" };
	}
	if (!auth.apiKey) {
		return { model: modelId, content: "", error: `No API key configured for ${provider}` };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);

	try {
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: controller.signal,
			},
		);

		const content = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		return { model: modelId, content };
	} catch (err) {
		return { model: modelId, content: "", error: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
	}
}

export async function queryModelsParallel(
	models: string[],
	prompt: string,
	apiKey: string,
	timeoutSecs: number,
	getApiKeyAndHeaders: (model: object) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>,
): Promise<ModelResponse[]> {
	return Promise.all(models.map((m) => queryModel(m, prompt, apiKey, timeoutSecs, getApiKeyAndHeaders)));
}
