import { sql } from "bun";
import { createApp } from "./app.js";

export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 15_000;

export interface GracefulShutdownDeps {
	stopServer: () => Promise<void> | void;
	stopReaper?: () => Promise<void> | void;
	drain: () => Promise<void>;
	closeDatabase?: () => Promise<void> | void;
	exit?: (code: number) => void;
	timeoutMs?: number;
	logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface SignalTarget {
	once: (event: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
	off?: (event: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
	removeListener?: (
		event: "SIGINT" | "SIGTERM",
		listener: () => void,
	) => unknown;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof (value as PromiseLike<T>).then === "function"
	);
}

function invokeDrainSafely(
	drain: () => Promise<void>,
	isTimedOut: () => boolean,
	logger: Pick<Console, "info" | "warn" | "error">,
): Promise<{ kind: "drained" } | { kind: "error"; error: unknown }> {
	return new Promise((resolve) => {
		try {
			Promise.resolve(drain()).then(
				() => resolve({ kind: "drained" }),
				(error: unknown) => {
					if (isTimedOut()) {
						logger.error(
							"Graceful shutdown drain rejected after timeout.",
							error,
						);
					}
					resolve({ kind: "error", error });
				},
			);
		} catch (error) {
			if (isTimedOut()) {
				logger.error("Graceful shutdown drain rejected after timeout.", error);
			}
			resolve({ kind: "error", error });
		}
	});
}

async function drainWithTimeout(
	drain: () => Promise<void>,
	timeoutMs: number,
	logger: Pick<Console, "info" | "warn" | "error">,
): Promise<void> {
	let timedOut = timeoutMs <= 0;
	const drainPromise = invokeDrainSafely(drain, () => timedOut, logger);
	if (timedOut) {
		logger.warn(
			`Graceful shutdown drain timed out after ${timeoutMs}ms; closing database.`,
		);
		return;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
		timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
		timer.unref?.();
	});
	try {
		const outcome = await Promise.race([drainPromise, timeoutPromise]);
		if (outcome.kind === "timeout") {
			timedOut = true;
			logger.warn(
				`Graceful shutdown drain timed out after ${timeoutMs}ms; closing database.`,
			);
			return;
		}
		if (outcome.kind === "error") {
			throw outcome.error;
		}
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

async function executeGracefulShutdown(
	deps: GracefulShutdownDeps,
): Promise<number> {
	const logger = deps.logger ?? console;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
	let exitCode = 0;

	for (const [stepName, step] of [
		["stopServer", deps.stopServer],
		["stopReaper", deps.stopReaper],
		["drain", () => drainWithTimeout(deps.drain, timeoutMs, logger)],
		["closeDatabase", deps.closeDatabase],
	] as const) {
		if (!step) {
			continue;
		}
		try {
			const result = step();
			if (isPromiseLike(result)) {
				await result;
			}
		} catch (error) {
			logger.error(`Graceful shutdown ${stepName} failed.`, error);
			exitCode = 1;
		}
	}

	deps.exit?.(exitCode);
	return exitCode;
}

export function createGracefulShutdownHandler(
	deps: GracefulShutdownDeps,
): (signal: "SIGTERM" | "SIGINT" | NodeJS.Signals) => Promise<number> {
	let inFlightPromise: Promise<number> | null = null;
	return (_signal) => {
		if (inFlightPromise === null) {
			inFlightPromise = executeGracefulShutdown(deps);
		}
		return inFlightPromise;
	};
}

export function registerGracefulShutdown(
	deps: GracefulShutdownDeps,
	target: SignalTarget = process,
): () => void {
	const logger = deps.logger ?? console;
	const handler = createGracefulShutdownHandler(deps);
	const invoke = (signal: "SIGINT" | "SIGTERM") => {
		void handler(signal).catch((error: unknown) => {
			logger.error("Unexpected graceful shutdown handler failure.", error);
		});
	};
	const onSigint = () => invoke("SIGINT");
	const onSigterm = () => invoke("SIGTERM");
	target.once("SIGINT", onSigint);
	target.once("SIGTERM", onSigterm);

	return () => {
		const detach = target.off ?? target.removeListener;
		detach?.call(target, "SIGINT", onSigint);
		detach?.call(target, "SIGTERM", onSigterm);
	};
}

function parseDrainTimeoutMs(raw: string | undefined): number {
	const trimmed = raw?.trim();
	if (!trimmed) return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
	}
	return Math.trunc(parsed);
}

async function startServer(): Promise<void> {
	const { app, env, drain, reaper, stopReaper } = await createApp();
	reaper?.start();

	const server = Bun.serve({
		port: env.port,
		fetch: app.fetch,
	});

	registerGracefulShutdown({
		stopServer: () => server.stop(),
		stopReaper,
		drain,
		closeDatabase: () => sql.close(),
		exit: (code) => process.exit(code),
		timeoutMs: parseDrainTimeoutMs(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS),
	});

	console.log(
		`festival backend listening on port ${server.port} (firebase + postgres org flow)`,
	);
}

if (import.meta.main) {
	await startServer();
}
