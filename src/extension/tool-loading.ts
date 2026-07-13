import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { ExtensionConfig } from "../shared/types.ts";

const LOADER_TOOL_NAME = "search_tools";
const SUBAGENT_TOOL_NAME = "subagent";
const WAIT_TOOL_NAME = "wait";

export interface NativeToolLoadingState {
	supervisorSearchable: boolean;
	nativeSupervisorToolNames: Set<string>;
}

type ToolResultEventLike = {
	toolName?: unknown;
	isError?: unknown;
	details?: { mode?: unknown; asyncId?: unknown };
};

const SearchToolsParams = Type.Object({
	query: Type.String({ description: "Capability or task to search for" }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 })),
});

type SearchToolsParams = Static<typeof SearchToolsParams>;

type SearchMatch = {
	name: string;
	score: number;
};

export function createNativeToolLoadingState(): NativeToolLoadingState {
	return {
		supervisorSearchable: false,
		nativeSupervisorToolNames: new Set(),
	};
}

function isEnabled(config: ExtensionConfig): boolean {
	return config.toolLoading?.enabled === true;
}

function score(haystack: string, terms: string[]): number {
	return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

function matchingToolNames(
	query: string,
	limit: number,
	state: NativeToolLoadingState,
): string[] {
	const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	if (terms.length === 0) return [];

	const matches: SearchMatch[] = [
		{
			name: SUBAGENT_TOOL_NAME,
			score: score("subagent delegate child agent worker reviewer research parallel chain orchestration", terms),
		},
	];

	if (state.supervisorSearchable) {
		if (state.nativeSupervisorToolNames.has("subagent_supervisor")) {
			matches.push({
				name: "subagent_supervisor",
				score: score("subagent supervisor reply pending status decision interview progress", terms),
			});
		}
		if (state.nativeSupervisorToolNames.has("intercom")) {
			matches.push({
				name: "intercom",
				score: score("intercom supervisor reply pending status decision interview progress", terms),
			});
		}
	}

	return matches
		.filter((match) => match.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((match) => match.name);
}

export function registerNativeToolLoader(
	pi: ExtensionAPI,
	config: ExtensionConfig,
	state: NativeToolLoadingState,
): void {
	if (!isEnabled(config)) return;

	const loader: ToolDefinition<typeof SearchToolsParams, { matches: string[]; added: string[] }> = {
		name: LOADER_TOOL_NAME,
		label: "Search Tools",
		description: "Search and enable deferred pi-subagents delegation tools, plus supervisor controls after a subagent run.",
		promptSnippet: "Search for pi-subagents delegation tools or post-delegation supervisor controls when needed",
		promptGuidelines: ["Use search_tools to load subagent for delegation, or native supervisor controls after a subagent run."],
		parameters: SearchToolsParams,
		async execute(_id, params) {
			const matches = matchingToolNames(params.query, params.limit ?? 2, state);
			const active = pi.getActiveTools();
			const added = matches.filter((name) => !active.includes(name));
			if (added.length > 0) pi.setActiveTools([...new Set([...active, ...added])]);

			return {
				content: [{
					type: "text",
					text: matches.length === 0
						? `No pi-subagents tools found for: ${params.query}`
						: added.length > 0
							? `Loaded tools: ${added.join(", ")}`
							: `Matching tools already active: ${matches.join(", ")}`,
				}],
				details: { matches, added },
			};
		},
	};

	pi.registerTool(loader);
}

export function isSuccessfulSubagentExecutionResult(event: ToolResultEventLike): boolean {
	return event.toolName === SUBAGENT_TOOL_NAME
		&& event.isError === false
		&& event.details?.mode !== "management"
		&& (event.details?.mode === "single" || event.details?.mode === "parallel" || event.details?.mode === "chain");
}

export function isAsyncSubagentExecutionResult(event: ToolResultEventLike): boolean {
	return isSuccessfulSubagentExecutionResult(event) && typeof event.details?.asyncId === "string";
}

export function activateNativeToolLoader(
	pi: ExtensionAPI,
	config: ExtensionConfig,
	state: NativeToolLoadingState,
	nativeToolNames: Iterable<string> = [],
): void {
	if (!isEnabled(config)) return;
	state.nativeSupervisorToolNames.clear();
	for (const name of nativeToolNames) state.nativeSupervisorToolNames.add(name);
	const deferredNames = new Set([SUBAGENT_TOOL_NAME, WAIT_TOOL_NAME, ...state.nativeSupervisorToolNames]);
	const active = pi.getActiveTools().filter((name) => !deferredNames.has(name));
	pi.setActiveTools([...new Set([...active, LOADER_TOOL_NAME])]);
}

export function activateWaitTool(pi: ExtensionAPI, config: ExtensionConfig): void {
	if (!isEnabled(config)) return;
	const active = pi.getActiveTools();
	if (active.includes(WAIT_TOOL_NAME)) return;
	pi.setActiveTools([...active, WAIT_TOOL_NAME]);
}
