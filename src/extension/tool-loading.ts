import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { ExtensionConfig } from "../shared/types.ts";

const LOADER_TOOL_NAME = "search_tools";
const DEFERRED_TOOL_NAMES = ["subagent", "wait"] as const;

const SearchToolsParams = Type.Object({
	query: Type.String({ description: "Capability or task to search for" }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 })),
});

type SearchToolsParams = Static<typeof SearchToolsParams>;

type SearchMatch = {
	name: (typeof DEFERRED_TOOL_NAMES)[number];
	score: number;
};

function isEnabled(config: ExtensionConfig): boolean {
	return config.toolLoading?.enabled === true;
}

function matchingToolNames(query: string, limit: number): string[] {
	const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	if (terms.length === 0) return [];

	const matches: SearchMatch[] = [
		{ name: "subagent", score: score("subagent delegate child agent worker reviewer research parallel chain async orchestration", terms) },
		{ name: "wait", score: score("wait background async subagent completion result", terms) },
	].filter((match) => match.score > 0);

	const names = matches
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((match) => match.name);

	// Delegation and waiting are one capability: loading subagent must also load wait.
	if (names.includes("subagent") && !names.includes("wait")) names.push("wait");
	return names;
}

function score(haystack: string, terms: string[]): number {
	return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

export function registerNativeToolLoader(pi: ExtensionAPI, config: ExtensionConfig): void {
	if (!isEnabled(config)) return;

	const loader: ToolDefinition<typeof SearchToolsParams, { matches: string[]; added: string[] }> = {
		name: LOADER_TOOL_NAME,
		label: "Search Tools",
		description: "Search and enable deferred pi-subagents tools for delegation and asynchronous-run control.",
		promptSnippet: "Search for pi-subagents delegation tools when they are needed",
		promptGuidelines: ["Use search_tools to load pi-subagents delegation or async-run control tools when they are needed."],
		parameters: SearchToolsParams,
		async execute(_id, params) {
			const matches = matchingToolNames(params.query, params.limit ?? DEFERRED_TOOL_NAMES.length);
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

export function activateNativeToolLoader(pi: ExtensionAPI, config: ExtensionConfig): void {
	if (!isEnabled(config)) return;
	const active = pi.getActiveTools().filter((name) => !DEFERRED_TOOL_NAMES.includes(name as (typeof DEFERRED_TOOL_NAMES)[number]));
	pi.setActiveTools([...new Set([...active, LOADER_TOOL_NAME])]);
}
