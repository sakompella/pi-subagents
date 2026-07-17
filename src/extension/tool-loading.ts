import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionConfig } from "../shared/types.ts";

const SUBAGENT_TOOL_NAME = "subagent";
const WAIT_TOOL_NAME = "subagent_wait";

export interface ToolResultEventLike {
	toolName?: unknown;
	isError?: unknown;
	details?: unknown;
}

function executionDetails(event: ToolResultEventLike): { mode?: unknown; asyncId?: unknown } {
	if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)) return {};
	return event.details as { mode?: unknown; asyncId?: unknown };
}

function isEnabled(config: ExtensionConfig): boolean {
	return config.deferredToolLoading === true;
}

function isNativeToolName(name: string): boolean {
	return name === "subagent_supervisor" || name === "intercom";
}

/**
 * A successful result from an actual delegation run, rather than a management
 * action or a failed/preflight result. The mode check keeps this guard narrow as
 * the subagent tool grows more management actions.
 */
export function isSuccessfulSubagentExecutionResult(event: ToolResultEventLike): boolean {
	const details = executionDetails(event);
	return event.toolName === SUBAGENT_TOOL_NAME
		&& event.isError === false
		&& (details.mode === "single" || details.mode === "parallel" || details.mode === "chain");
}

export function isAsyncSubagentExecutionResult(event: ToolResultEventLike): boolean {
	return isSuccessfulSubagentExecutionResult(event) && typeof executionDetails(event).asyncId === "string";
}

/**
 * At session start, hide only the tools whose availability is intentionally
 * event-driven. This is the one non-additive update: it establishes the
 * pre-execution contract while retaining all upstream/default tools, including
 * an externally-owned intercom.
 */
export function configureEventDrivenToolActivation(
	pi: ExtensionAPI,
	config: ExtensionConfig,
	nativeToolNames: Iterable<string> = [],
): void {
	if (!isEnabled(config)) return;
	const deferred = new Set<string>([WAIT_TOOL_NAME]);
	for (const name of nativeToolNames) {
		if (isNativeToolName(name)) deferred.add(name);
	}
	const active = pi.getActiveTools();
	const filtered = active.filter((name) => !deferred.has(name));
	if (filtered.length !== active.length) pi.setActiveTools(filtered);
}

/** Add native supervisor controls without changing any currently active tool. */
export function activateNativeSupervisorTools(
	pi: ExtensionAPI,
	config: ExtensionConfig,
	nativeToolNames: Iterable<string>,
): void {
	if (!isEnabled(config)) return;
	const active = pi.getActiveTools();
	const added = [...new Set(nativeToolNames)].filter((name) => isNativeToolName(name) && !active.includes(name));
	if (added.length > 0) pi.setActiveTools([...active, ...added]);
}

/** Add the wait tool only for a successful asynchronous execution. */
export function activateWaitTool(pi: ExtensionAPI, config: ExtensionConfig): void {
	if (!isEnabled(config)) return;
	const active = pi.getActiveTools();
	if (active.includes(WAIT_TOOL_NAME)) return;
	pi.setActiveTools([...active, WAIT_TOOL_NAME]);
}

/** Apply the event-driven transition represented by one tool-result event. */
export function activateToolsAfterSubagentResult(
	pi: ExtensionAPI,
	config: ExtensionConfig,
	event: ToolResultEventLike,
	nativeToolNames: Iterable<string>,
): void {
	if (!isSuccessfulSubagentExecutionResult(event)) return;
	activateNativeSupervisorTools(pi, config, nativeToolNames);
	if (isAsyncSubagentExecutionResult(event)) activateWaitTool(pi, config);
}
