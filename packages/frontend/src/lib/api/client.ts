import type { ClassCheckoutRecoveryStatusDto } from "@festival/common";
import { getFirebaseAuth } from "../firebase-auth.js";

export const API_BASE = import.meta.env.FRONT_API_BASE ?? "";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly recovery?: ClassCheckoutRecoveryStatusDto,
	) {
		super(message);
	}
}

export async function resolveAuthToken(
	explicitToken?: string | null,
): Promise<string | null> {
	if (explicitToken) return explicitToken;
	try {
		const auth = getFirebaseAuth();
		if (auth?.currentUser) {
			return await auth.currentUser.getIdToken();
		}
	} catch {
		// Ignore if auth is unavailable
	}
	return null;
}

const CANONICAL_HEADER_NAMES: Record<string, string> = {
	authorization: "Authorization",
	"content-type": "Content-Type",
	"idempotency-key": "Idempotency-Key",
	"x-csrf-token": "X-CSRF-Token",
};

function toCanonicalHeaderMap(headers?: HeadersInit): Record<string, string> {
	const result: Record<string, string> = {};
	if (!headers) return result;
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			result[CANONICAL_HEADER_NAMES[key.toLowerCase()] ?? key] = value;
		});
		return result;
	}
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			result[CANONICAL_HEADER_NAMES[key.toLowerCase()] ?? key] = value;
		}
		return result;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (value !== undefined) {
			result[CANONICAL_HEADER_NAMES[key.toLowerCase()] ?? key] = value;
		}
	}
	return result;
}

export interface RpcRequestOptions {
	idToken?: string | null;
	extraHeaders?: Record<string, string>;
	signal?: AbortSignal;
}

export function createRpcFetch(options?: RpcRequestOptions): typeof fetch {
	const rpcFetch = (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(options?.idToken
				? { Authorization: `Bearer ${options.idToken}` }
				: {}),
			...toCanonicalHeaderMap(init?.headers),
			...(options?.extraHeaders ?? {}),
		};
		return globalThis.fetch(url, {
			...init,
			credentials: "include",
			...(options?.signal ? { signal: options.signal } : {}),
			headers,
		});
	};
	return Object.assign(rpcFetch, {
		preconnect: globalThis.fetch.preconnect ?? (() => undefined),
	}) as typeof fetch;
}

export function apiPrefix(useApiBase = true): string {
	return `${useApiBase ? API_BASE : ""}/api`;
}

export async function unwrapRpcResponse<T>(
	response: Response,
	fallbackPath: string,
): Promise<T> {
	const payload = (await response.json()) as
		| T
		| {
				error?: string;
				code?: string;
				recovery?: ClassCheckoutRecoveryStatusDto;
		  };
	if (!response.ok) {
		const errorPayload = payload as {
			error?: string;
			code?: string;
			recovery?: ClassCheckoutRecoveryStatusDto;
		};
		throw new ApiError(
			errorPayload.error ?? `Request failed for ${fallbackPath}`,
			response.status,
			errorPayload.code,
			errorPayload.recovery,
		);
	}
	return payload as T;
}

export async function rpcCall<T>(
	responsePromise: Promise<Response>,
	fallbackPath: string,
): Promise<T> {
	return unwrapRpcResponse<T>(await responsePromise, fallbackPath);
}

export function rpcQuery<T extends Record<string, unknown>>(query: T): T {
	const defined: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) {
			defined[key] = value;
		}
	}
	return (Object.keys(defined).length > 0 ? defined : undefined) as T;
}
