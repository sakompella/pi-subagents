import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activateNativeToolLoader, registerNativeToolLoader } from "../../src/extension/tool-loading.ts";

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

	it("does nothing unless explicitly enabled", () => {
		let registrations = 0;
		let activations = 0;
		const pi = {
			registerTool() { registrations += 1; },
			getActiveTools() { return ["subagent", "wait"]; },
			setActiveTools() { activations += 1; },
		};

		registerNativeToolLoader(pi as never, {});
		activateNativeToolLoader(pi as never, {});
		assert.equal(registrations, 0);
		assert.equal(activations, 0);
	});
});
