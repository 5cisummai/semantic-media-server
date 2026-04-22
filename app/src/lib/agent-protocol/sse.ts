import { parseAgentSseEvent, type AgentSseEvent } from './events';

export interface ConsumeSseOptions<TEvent> {
	signal?: AbortSignal;
	onEvent: (event: TEvent) => void;
	parseEvent: (eventName: string, payload: unknown) => TEvent | null;
}

function parseSseChunk(block: string): { eventName: string; data: string } | null {
	const lines = block.split(/\r?\n/);
	let eventName = '';
	const dataLines: string[] = [];

	for (const line of lines) {
		if (!line || line.startsWith(':')) continue;
		if (line.startsWith('event:')) {
			eventName = line.slice(6).trim();
			continue;
		}
		if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trimStart());
		}
	}

	if (!eventName || dataLines.length === 0) return null;
	return { eventName, data: dataLines.join('\n') };
}

export async function consumeSseStream<TEvent>(
	response: Response,
	options: ConsumeSseOptions<TEvent>
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error('No response body');

	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			if (options.signal?.aborted) break;
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const chunks = buffer.split(/\r?\n\r?\n/);
			buffer = chunks.pop() ?? '';

			for (const chunk of chunks) {
				const parsed = parseSseChunk(chunk);
				if (!parsed) continue;
				try {
					const payload = JSON.parse(parsed.data) as unknown;
					const event = options.parseEvent(parsed.eventName, payload);
					if (event) options.onEvent(event);
				} catch {
					// malformed payload — skip line
				}
			}
		}
	} finally {
		await reader.cancel();
	}
}

export function consumeAgentSseStream(
	response: Response,
	options: Omit<ConsumeSseOptions<AgentSseEvent>, 'parseEvent'>
): Promise<void> {
	return consumeSseStream(response, {
		...options,
		parseEvent: parseAgentSseEvent
	});
}
