import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activateNativeSupervisorTools,
	activateNativeToolLoader,
	isSuccessfulSubagentResult,
	registerNativeToolLoader,
} from "../../src/extension/tool-loading.ts";

type LoaderResult = { details: { matches: string[]; added: string[] } };
type LoaderTool = { name: string; execute?: (id: string, params: { query: string }, signal?: AbortSignal) => Promise<LoaderResult> };

describe("native pi tool loading", () => {
	it("defers subagent and wait, then additively loads both for delegation", async () => {
		const registered = new Map<string, LoaderTool>();
		let active = ["read", "subagent", "wait", "grep"];
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

		const config = { toolLoading: { enabled: true } };
		registerNativeToolLoader(pi as never, config);
		activateNativeToolLoader(pi as never, config);
		assert.deepEqual(active, ["read", "grep", "search_tools"]);

		const loader = registered.get("search_tools");
		assert.ok(loader?.execute, "search_tools should be registered");
		const result = await loader.execute!("load-subagent", { query: "delegate a worker" });
		assert.deepEqual(result.details, { matches: ["subagent", "wait"], added: ["subagent", "wait"] });
		assert.deepEqual(active, ["read", "grep", "search_tools", "subagent", "wait"]);
	});

	it("defers supplied native supervisor tools while retaining an external intercom", () => {
		let active = ["read", "subagent", "wait", "grep", "intercom", "subagent_supervisor"];
		let activations = 0;
		const pi = {
			getActiveTools() {
				return [...active];
			},
			setActiveTools(names: string[]) {
				activations += 1;
				active = names;
			},
		};
		const config = { toolLoading: { enabled: true } };

		activateNativeToolLoader(pi as never, config, ["subagent_supervisor"]);
		assert.deepEqual(active, ["read", "grep", "intercom", "search_tools"]);
		activateNativeSupervisorTools(pi as never, config, ["subagent_supervisor"]);
		assert.deepEqual(active, ["read", "grep", "intercom", "search_tools", "subagent_supervisor"]);
		activateNativeSupervisorTools(pi as never, config, ["subagent_supervisor"]);
		assert.equal(activations, 2, "repeated activation does not call setActiveTools");
	});

	it("keeps supervisor names out of search results and activates only after success", async () => {
		const registered = new Map<string, LoaderTool>();
		let active = ["search_tools"];
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
		const config = { toolLoading: { enabled: true } };
		registerNativeToolLoader(pi as never, config);
		const loader = registered.get("search_tools");
		assert.ok(loader?.execute);
		const result = await loader.execute!("supervisor", { query: "supervisor intercom" });
		assert.deepEqual(result.details, { matches: [], added: [] });
		assert.equal(isSuccessfulSubagentResult({ toolName: "subagent", isError: false }), true);
		assert.equal(isSuccessfulSubagentResult({ toolName: "subagent", isError: true }), false);
		assert.equal(isSuccessfulSubagentResult({ toolName: "subagent" }), false);
		assert.equal(isSuccessfulSubagentResult({ toolName: "intercom", isError: false }), false);
	});

	it("does nothing unless explicitly enabled", () => {
		let registrations = 0;
		let activations = 0;
		const pi = {
			registerTool() { registrations += 1; },
			getActiveTools() { return ["subagent", "wait"]; },
			setActiveTools() { activations += 1; },
		};

		registerNativeToolLoader(pi as never, {});
		activateNativeToolLoader(pi as never, {}, ["subagent_supervisor", "intercom"]);
		activateNativeSupervisorTools(pi as never, {}, ["subagent_supervisor", "intercom"]);
		assert.equal(registrations, 0);
		assert.equal(activations, 0);
	});
});
