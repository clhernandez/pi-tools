import { complete, getModel } from "@mariozechner/pi-ai";

export interface ModelResponse {
	model: string;
	content: string;
	error?: string;
}

export type ProgressEvent =
	| { type: "start"; model: string }
	| { type: "done"; model: string; ok: boolean; error?: string };

export type GetApiKeyAndHeaders = (
	model: object,
) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;

export async function queryModel(
	modelId: string,
	prompt: string,
	timeoutSecs: number,
	getApiKeyAndHeaders: GetApiKeyAndHeaders,
	signal?: AbortSignal,
): Promise<ModelResponse> {
	const [provider, ...rest] = modelId.split("/");
	const id = rest.join("/");

	const model = getModel(provider, id);
	if (!model) {
		return { model: modelId, content: "", error: `Model not found in pi registry: ${modelId}` };
	}

	const auth = await getApiKeyAndHeaders(model);
	if (!auth.ok) return { model: modelId, content: "", error: auth.error ?? "Auth failed" };
	if (!auth.apiKey) return { model: modelId, content: "", error: `No API key configured for ${provider}` };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutSecs}s`)), timeoutSecs * 1000);
	const onParentAbort = () => controller.abort();
	signal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const response = await complete(
			model,
			{
				messages: [
					{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
				],
			},
			{ apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal },
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
		signal?.removeEventListener("abort", onParentAbort);
	}
}

export async function queryModelsParallel(
	models: string[],
	prompt: string,
	timeoutSecs: number,
	getApiKeyAndHeaders: GetApiKeyAndHeaders,
	onProgress?: (event: ProgressEvent) => void,
	signal?: AbortSignal,
): Promise<ModelResponse[]> {
	return Promise.all(
		models.map(async (m) => {
			onProgress?.({ type: "start", model: m });
			const r = await queryModel(m, prompt, timeoutSecs, getApiKeyAndHeaders, signal);
			const hasContent = r.content.trim().length > 0;
			const ok = !r.error && hasContent;
			const error = r.error ?? (hasContent ? undefined : "Empty response");
			onProgress?.({ type: "done", model: m, ok, error });
			return r;
		}),
	);
}
