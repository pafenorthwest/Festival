import { resolve4, resolve6 } from "node:dns/promises";
import { Agent, request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { BoundedAsyncCache } from "./bounded-async-cache.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_ENTRY_BYTES = 256 * 1024;
const DEFAULT_TOTAL_BYTES = 4 * 1024 * 1024;

export interface DnsAnswer {
	address: string;
	family: 4 | 6;
	ttlSeconds: number;
}

interface DnsLease {
	answers: DnsAnswer[];
	agent: Agent;
	next: number;
	/**
	 * A cache lease can expire while a response that selected it is still being
	 * consumed. Keep an explicit request count instead of treating cache removal
	 * as proof that the agent is idle.
	 */
	activeRequests: number;
	/** Retired leases are unavailable to new requests but may still be in use. */
	retired: boolean;
	/** Prevent repeated Agent.destroy() calls as concurrent requests release. */
	destroyed: boolean;
}

export interface CustomerAccountRawResponse {
	status: number;
	contentLength?: number;
	body: AsyncIterable<Uint8Array>;
	cancel?: () => void;
}

export type CustomerAccountResolver = (
	hostname: string,
) => Promise<readonly DnsAnswer[]>;
export type CustomerAccountRequester = (
	url: URL,
	answer: DnsAnswer,
	agent: Agent,
	init?: RequestInit,
) => Promise<CustomerAccountRawResponse>;

export interface CustomerAccountTransportOptions {
	resolver?: CustomerAccountResolver;
	requester?: CustomerAccountRequester;
	now?: () => number;
	dnsMaxEntries?: number;
	dnsTtlMs?: number;
	maxEntryBytes?: number;
	maxTotalBytes?: number;
}

const blocked = new BlockList();
for (const [address, prefix, family] of [
	["0.0.0.0", 8, "ipv4"],
	["10.0.0.0", 8, "ipv4"],
	["100.64.0.0", 10, "ipv4"],
	["127.0.0.0", 8, "ipv4"],
	["169.254.0.0", 16, "ipv4"],
	["172.16.0.0", 12, "ipv4"],
	["192.0.0.0", 24, "ipv4"],
	["192.0.2.0", 24, "ipv4"],
	["192.88.99.0", 24, "ipv4"],
	["192.168.0.0", 16, "ipv4"],
	["198.18.0.0", 15, "ipv4"],
	["198.51.100.0", 24, "ipv4"],
	["203.0.113.0", 24, "ipv4"],
	["224.0.0.0", 4, "ipv4"],
	["240.0.0.0", 4, "ipv4"],
	["::", 96, "ipv6"],
	["::1", 128, "ipv6"],
	["64:ff9b::", 96, "ipv6"],
	["64:ff9b:1::", 48, "ipv6"],
	["100::", 64, "ipv6"],
	["2001::", 23, "ipv6"],
	["2001:db8::", 32, "ipv6"],
	["2002::", 16, "ipv6"],
	["3fff::", 20, "ipv6"],
	["fc00::", 7, "ipv6"],
	["fe80::", 10, "ipv6"],
	["fec0::", 10, "ipv6"],
	["ff00::", 8, "ipv6"],
] as const)
	blocked.addSubnet(address, prefix, family);

export function isGlobalAddress(answer: DnsAnswer) {
	const family = isIP(answer.address);
	let normalized = answer.address.toLowerCase();
	if (family === 6) {
		try {
			normalized = new URL(`http://[${answer.address}]/`).hostname.slice(1, -1);
		} catch {
			return false;
		}
	}
	return (
		family === answer.family &&
		!(family === 6 && normalized.startsWith("::ffff:")) &&
		Number.isFinite(answer.ttlSeconds) &&
		answer.ttlSeconds > 0 &&
		!blocked.check(answer.address, family === 4 ? "ipv4" : "ipv6")
	);
}

async function defaultResolver(hostname: string): Promise<DnsAnswer[]> {
	const [v4, v6] = await Promise.all([
		resolve4(hostname, { ttl: true }).catch(() => []),
		resolve6(hostname, { ttl: true }).catch(() => []),
	]);
	return [
		...v4.map((entry) => ({
			address: entry.address,
			family: 4 as const,
			ttlSeconds: entry.ttl,
		})),
		...v6.map((entry) => ({
			address: entry.address,
			family: 6 as const,
			ttlSeconds: entry.ttl,
		})),
	];
}

async function defaultRequester(
	url: URL,
	answer: DnsAnswer,
	agent: Agent,
	init?: RequestInit,
): Promise<CustomerAccountRawResponse> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		headers.host = url.hostname;
		let body: string | undefined;
		if (init?.body !== undefined && init.body !== null) {
			if (
				typeof init.body !== "string" &&
				!(init.body instanceof URLSearchParams)
			) {
				reject(new Error("Unsupported Customer Account request body."));
				return;
			}
			body = init.body.toString();
			if (headers["content-length"] === undefined)
				headers["content-length"] = String(Buffer.byteLength(body));
		}
		const request = httpsRequest(
			{
				hostname: answer.address,
				family: answer.family,
				port: 443,
				servername: url.hostname,
				path: `${url.pathname}${url.search}`,
				method: init?.method ?? "GET",
				headers,
				agent,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
			(response) => {
				resolve({
					status: response.statusCode ?? 0,
					contentLength: Number(response.headers["content-length"] ?? 0),
					body: response,
					cancel: () => response.destroy(),
				});
			},
		);
		request.on("error", reject);
		if (body !== undefined) request.write(body);
		request.end();
	});
}

export class CustomerAccountTransport {
	private resolver: CustomerAccountResolver;
	private requester: CustomerAccountRequester;
	private dnsTtlMs: number;
	private dns: BoundedAsyncCache<string, DnsLease>;

	constructor(options: CustomerAccountTransportOptions = {}) {
		this.resolver = options.resolver ?? defaultResolver;
		this.requester = options.requester ?? defaultRequester;
		this.dnsTtlMs = options.dnsTtlMs ?? 60_000;
		this.dns = new BoundedAsyncCache({
			maxEntries: options.dnsMaxEntries ?? 1_024,
			maxEntryBytes: options.maxEntryBytes ?? DEFAULT_ENTRY_BYTES,
			maxTotalBytes: options.maxTotalBytes ?? DEFAULT_TOTAL_BYTES,
			now: options.now,
			/*
			 * Removing a lease from the cache is sufficient to stop new requests from
			 * selecting it. Agent.destroy() is deliberately deferred when a request is
			 * active because Node destroys sockets in both the idle and active pools.
			 * Destroying here unconditionally would let a TTL rollover, LRU eviction, or
			 * metrics scrape abort an unrelated response that is still streaming.
			 */
			onEvict: (lease) => this.retireLease(lease),
		});
	}

	private retireLease(lease: DnsLease) {
		lease.retired = true;
		this.destroyRetiredLeaseIfIdle(lease);
	}

	private destroyRetiredLeaseIfIdle(lease: DnsLease) {
		/*
		 * Retirement and destruction are separate lifecycle events. Retirement is
		 * immediate at DNS expiry, preserving the security boundary: no later request
		 * can reuse an address or connection validated by the old DNS answer. Physical
		 * destruction waits only for requests that already acquired the lease, and the
		 * final releaser closes both idle keep-alive sockets and its completed socket.
		 */
		if (lease.retired && lease.activeRequests === 0 && !lease.destroyed) {
			lease.destroyed = true;
			lease.agent.destroy();
		}
	}

	private acquireLease(lease: DnsLease) {
		/*
		 * lease() and this increment execute in the same JavaScript continuation, so
		 * cache expiry cannot interleave between selection and acquisition. A retired
		 * lease here would therefore indicate an internal lifecycle violation.
		 */
		if (lease.retired)
			throw new Error("Customer Account DNS lease is already retired.");
		lease.activeRequests++;
	}

	private releaseLease(lease: DnsLease) {
		if (lease.activeRequests <= 0)
			throw new Error("Customer Account DNS lease release is unbalanced.");
		lease.activeRequests--;
		this.destroyRetiredLeaseIfIdle(lease);
	}

	assertDestination(url: URL, configuredDomain: string) {
		if (url.protocol !== "https:" || url.username || url.password || url.port)
			throw new Error("Unsafe Customer Account destination.");
		const host = url.hostname.toLowerCase();
		const domain = configuredDomain.toLowerCase();
		const allowedShopifyHost =
			host.endsWith(".shopify.com") || host.endsWith(".myshopify.com");
		if (
			(host !== domain && !allowedShopifyHost) ||
			/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
			host.includes(":")
		)
			throw new Error("Unsafe Customer Account destination.");
	}

	private async lease(hostname: string) {
		return this.dns.getOrLoad(hostname, async () => {
			const answers = [...(await this.resolver(hostname))];
			if (!answers.length || answers.some((answer) => !isGlobalAddress(answer)))
				throw new Error("Unsafe Customer Account DNS response.");
			const ttlMs = Math.min(
				this.dnsTtlMs,
				Math.min(...answers.map((answer) => answer.ttlSeconds * 1_000)),
			);
			const bytes = Buffer.byteLength(JSON.stringify(answers));
			return {
				value: {
					answers,
					agent: new Agent({ keepAlive: true }),
					next: 0,
					activeRequests: 0,
					retired: false,
					destroyed: false,
				},
				ttlMs,
				bytes,
			};
		});
	}

	async json(url: URL, configuredDomain: string, init?: RequestInit) {
		this.assertDestination(url, configuredDomain);
		const lease = await this.lease(url.hostname.toLowerCase());
		this.acquireLease(lease);
		try {
			/*
			 * Hold the lease through complete body consumption, not merely until response
			 * headers arrive. The HTTPS agent still owns the active socket while the async
			 * body is streaming, so releasing at headers would reintroduce the rollover
			 * race this lifecycle is designed to prevent.
			 */
			const answer = lease.answers[lease.next++ % lease.answers.length];
			if (!answer) throw new Error("Unsafe Customer Account DNS response.");
			const response = await this.requester(url, answer, lease.agent, init);
			if (response.status < 200 || response.status >= 300) {
				response.cancel?.();
				throw new Error("Customer Account upstream request failed.");
			}
			if (
				response.contentLength !== undefined &&
				response.contentLength > MAX_RESPONSE_BYTES
			) {
				response.cancel?.();
				throw new Error("Customer Account response is too large.");
			}
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			for await (const chunk of response.body) {
				bytes += chunk.byteLength;
				if (bytes > MAX_RESPONSE_BYTES) {
					response.cancel?.();
					throw new Error("Customer Account response is too large.");
				}
				chunks.push(chunk);
			}
			const parsed: unknown = JSON.parse(
				Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
					"utf8",
				),
			);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				throw new Error("Customer Account response is invalid.");
			return parsed as Record<string, unknown>;
		} finally {
			/* Every requester, stream, size, and parse failure releases exactly once. */
			this.releaseLease(lease);
		}
	}

	metrics() {
		return this.dns.metrics();
	}
}
