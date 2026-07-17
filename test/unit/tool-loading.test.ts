import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activateToolsAfterSubagentResult,
	configureEventDrivenToolActivation,
	isAsyncSubagentExecutionResult,
	isSuccessfulSubagentExecutionResult,
} from "../../src/extension/tool-loading.ts";

function makePi(initialActive: string[]) {
	let active = [...initialActive];
	let setCalls = 0;
	const pi = {
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			setCalls++;
			active = [...names];
		},
	};
	return { pi, active: () => [...active], setCalls: () => setCalls };
}

const enabled = { deferredToolLoading: true };

function execution(mode: "single" | "parallel" | "chain", asyncId?: string) {
	return {
		toolName: "subagent",
		isError: false,
		details: { mode, ...(asyncId ? { asyncId } : {}) },
	};
}

describe("event-driven native tool activation", () => {
	it("keeps subagent active and hides only deferred native tools at session start", () => {
		const harness = makePi(["read", "subagent", "subagent_wait", "subagent_supervisor", "intercom", "bash"]);
		configureEventDrivenToolActivation(harness.pi as never, enabled, ["subagent_supervisor", "intercom"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "bash"]);
		assert.equal(harness.setCalls(), 1);
	});

	it("preserves an external intercom while filtering native supervisor controls", () => {
		const harness = makePi(["read", "subagent", "subagent_wait", "subagent_supervisor", "intercom"]);
		// The channel reports only the native supervisor because intercom was
		// already registered by another extension.
		configureEventDrivenToolActivation(harness.pi as never, enabled, ["subagent_supervisor"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "intercom"]);
	});

	it("adds supervisor controls after successful sync execution without wait", () => {
		const harness = makePi(["read", "subagent"]);
		activateToolsAfterSubagentResult(harness.pi as never, enabled, execution("single"), ["subagent_supervisor", "intercom"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "subagent_supervisor", "intercom"]);
	});

	it("adds supervisor controls and wait after successful async execution", () => {
		const harness = makePi(["read", "subagent"]);
		const result = execution("parallel", "async-1");
		assert.equal(isAsyncSubagentExecutionResult(result), true);
		activateToolsAfterSubagentResult(harness.pi as never, enabled, result, ["subagent_supervisor", "intercom"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "subagent_supervisor", "intercom", "subagent_wait"]);
	});

	it("does not treat management, failed, or malformed results as executions", () => {
		const harness = makePi(["read", "subagent"]);
		const events = [
			{ toolName: "subagent", isError: false, details: { mode: "management", asyncId: "management-1" } },
			{ ...execution("single"), isError: true },
			{ toolName: "subagent", isError: false, details: { asyncId: "missing-mode" } },
			{ toolName: "intercom", isError: false, details: { mode: "single" } },
		];
		for (const event of events) {
			assert.equal(isSuccessfulSubagentExecutionResult(event), false);
			assert.equal(isAsyncSubagentExecutionResult(event), false);
			activateToolsAfterSubagentResult(harness.pi as never, enabled, event, ["subagent_supervisor", "intercom"]);
		}

		assert.deepEqual(harness.active(), ["read", "subagent"]);
		assert.equal(harness.setCalls(), 0);
	});

	it("keeps every runtime activation additive and idempotent", () => {
		const harness = makePi(["read", "subagent", "custom"]);
		activateToolsAfterSubagentResult(harness.pi as never, enabled, execution("chain"), ["subagent_supervisor"]);
		activateToolsAfterSubagentResult(harness.pi as never, enabled, execution("single", "async-2"), ["subagent_supervisor"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "custom", "subagent_supervisor", "subagent_wait"]);
		assert.equal(harness.setCalls(), 2);
	});

	it("preserves compatibility when event-driven activation is disabled", () => {
		const harness = makePi(["read", "subagent", "subagent_wait", "intercom"]);
		const disabled = {};
		configureEventDrivenToolActivation(harness.pi as never, disabled, ["subagent_supervisor", "intercom"]);
		activateToolsAfterSubagentResult(harness.pi as never, disabled, execution("single", "async-3"), ["subagent_supervisor", "intercom"]);

		assert.deepEqual(harness.active(), ["read", "subagent", "subagent_wait", "intercom"]);
		assert.equal(harness.setCalls(), 0);
	});
});
