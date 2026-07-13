import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activateNativeToolLoader,
	activateWaitTool,
	createNativeToolLoadingState,
	isAsyncSubagentExecutionResult,
	isSuccessfulSubagentExecutionResult,
	registerNativeToolLoader,
} from "../../src/extension/tool-loading.ts";

type LoaderResult = { details: { matches: string[]; added: string[] } };
type LoaderTool = { name: string; execute?: (id: string, params: { query: string }, signal?: AbortSignal) => Promise<LoaderResult> };

function makePi(initialActive: string[]) {
	const registered = new Map<string, LoaderTool>();
	let active = [...initialActive];
	const pi = {
		registerTool(tool: LoaderTool) {
			registered.set(tool.name, tool);
		},
		getActiveTools() {
			return [...active];
		},
		setActiveTools(names: string[]) {
			active = names;
		},
	};
	return { pi, registered, active: () => active };
}

async function search(loader: LoaderTool, query: string): Promise<LoaderResult> {
	assert.ok(loader.execute, "search_tools should be registered");
	return loader.execute!("search", { query });
}

describe("native pi tool loading", () => {
	it("initially exposes only subagent for delegation", async () => {
		const harness = makePi(["read", "subagent", "wait", "grep", "subagent_supervisor", "intercom"]);
		const config = { toolLoading: { enabled: true } };
		const state = createNativeToolLoadingState();
		registerNativeToolLoader(harness.pi as never, config, state);
		activateNativeToolLoader(harness.pi as never, config, state, ["subagent_supervisor", "intercom"]);

		assert.deepEqual(harness.active(), ["read", "grep", "search_tools"]);
		const loader = harness.registered.get("search_tools")!;
		assert.deepEqual((await search(loader, "delegate a worker")).details, { matches: ["subagent"], added: ["subagent"] });
		assert.deepEqual((await search(loader, "wait for completion")).details, { matches: [], added: [] });
	});

	it("makes native supervisor tools searchable only after a sync execution result", async () => {
		const harness = makePi(["search_tools"]);
		const config = { toolLoading: { enabled: true } };
		const state = createNativeToolLoadingState();
		state.nativeSupervisorToolNames.add("subagent_supervisor");
		state.nativeSupervisorToolNames.add("intercom");
		registerNativeToolLoader(harness.pi as never, config, state);
		const loader = harness.registered.get("search_tools")!;

		assert.deepEqual((await search(loader, "supervisor reply intercom")).details.matches, []);
		assert.equal(isSuccessfulSubagentExecutionResult({ toolName: "subagent", isError: false, details: { mode: "single" } }), true);
		state.supervisorSearchable = true;
		assert.deepEqual((await search(loader, "supervisor reply")).details.matches, ["subagent_supervisor", "intercom"]);
		assert.deepEqual(harness.active(), ["search_tools", "subagent_supervisor", "intercom"]);
	});

	it("activates wait only after an async execution result", () => {
		const harness = makePi(["search_tools"]);
		const config = { toolLoading: { enabled: true } };
		const sync = { toolName: "subagent", isError: false, details: { mode: "single" } };
		const asyncResult = { toolName: "subagent", isError: false, details: { mode: "single", asyncId: "run-1" } };

		assert.equal(isAsyncSubagentExecutionResult(sync), false);
		assert.equal(isAsyncSubagentExecutionResult(asyncResult), true);
		activateWaitTool(harness.pi as never, config);
		assert.deepEqual(harness.active(), ["search_tools", "wait"]);
	});

	it("does not treat management calls as execution or change loading state", async () => {
		const harness = makePi(["search_tools"]);
		const config = { toolLoading: { enabled: true } };
		const state = createNativeToolLoadingState();
		state.nativeSupervisorToolNames.add("subagent_supervisor");
		registerNativeToolLoader(harness.pi as never, config, state);
		const management = { toolName: "subagent", isError: false, details: { mode: "management", asyncId: "run-1" } };

		assert.equal(isSuccessfulSubagentExecutionResult(management), false);
		assert.equal(isAsyncSubagentExecutionResult(management), false);
		assert.equal(state.supervisorSearchable, false);
		assert.deepEqual((await search(harness.registered.get("search_tools")!, "supervisor")).details.matches, []);
	});

	it("never manages an externally owned intercom", () => {
		const harness = makePi(["read", "intercom", "subagent_supervisor"]);
		const config = { toolLoading: { enabled: true } };
		const state = createNativeToolLoadingState();
		state.nativeSupervisorToolNames.add("subagent_supervisor");
		activateNativeToolLoader(harness.pi as never, config, state, ["subagent_supervisor"]);
		assert.deepEqual(harness.active(), ["read", "intercom", "search_tools"]);
	});

	it("preserves disabled behavior", () => {
		const harness = makePi(["subagent", "wait"]);
		const config = {};
		const state = createNativeToolLoadingState();
		registerNativeToolLoader(harness.pi as never, config, state);
		activateNativeToolLoader(harness.pi as never, config, state, ["subagent_supervisor", "intercom"]);
		activateWaitTool(harness.pi as never, config);
		assert.equal(harness.registered.size, 0);
		assert.deepEqual(harness.active(), ["subagent", "wait"]);
	});
});
