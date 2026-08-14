import { generateKeyPairSync, sign } from "node:crypto";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

const ITERATIONS = 120;
const CONCURRENCY = 12;
const ISSUER = "https://shopify.com/authentication/benchmark";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = keys.publicKey.export({ format: "jwk" });

function percentile(values: number[], fraction: number) {
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[
			Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
		] ?? 0
	);
}

function token(nonce: string, now: Date) {
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", kid: "bench" }),
	).toString("base64url");
	const claims = Buffer.from(
		JSON.stringify({
			iss: ISSUER,
			aud: "benchmark-client",
			exp: Math.floor(now.getTime() / 1_000) + 3_600,
			nonce,
		}),
	).toString("base64url");
	const input = `${header}.${claims}`;
	return `${input}.${sign("RSA-SHA256", Buffer.from(input), keys.privateKey).toString("base64url")}`;
}

async function run(mode: "uncached" | "warm") {
	let now = new Date("2026-08-14T00:00:00.000Z");
	let resolverCalls = 0;
	const upstream = { discovery: 0, jwks: 0, token: 0, graphql: 0 };
	const nonceByCode = new Map<string, string>();
	const encoder = new TextEncoder();
	const transport = new CustomerAccountTransport({
		now: () => now.getTime(),
		dnsTtlMs: mode === "warm" ? 60_000 : 1,
		resolver: async () => {
			resolverCalls++;
			return [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }];
		},
		requester: async (url, _answer, _agent, init) => {
			let value: unknown;
			if (url.pathname === "/.well-known/openid-configuration") {
				upstream.discovery++;
				value = {
					issuer: ISSUER,
					authorization_endpoint: "https://accounts.shopify.com/auth",
					token_endpoint: "https://accounts.shopify.com/token",
					end_session_endpoint: "https://accounts.shopify.com/logout",
					jwks_uri: "https://accounts.shopify.com/jwks",
				};
			} else if (url.pathname === "/.well-known/customer-account-api") {
				upstream.discovery++;
				value = {
					graphql_api:
						"https://accounts.shopify.com/customer/api/2026-07/graphql",
				};
			} else if (url.pathname === "/jwks") {
				upstream.jwks++;
				value = {
					keys: [{ ...publicJwk, kid: "bench", alg: "RS256", use: "sig" }],
				};
			} else if (url.pathname === "/token") {
				upstream.token++;
				const body = new URLSearchParams(String(init?.body));
				const code = body.get("code") ?? "";
				value = {
					access_token: `access-${code}`,
					refresh_token: `refresh-${code}`,
					id_token: token(nonceByCode.get(code) ?? "", now),
					expires_in: 3_600,
				};
			} else {
				upstream.graphql++;
				value = { data: { customer: { id: "gid://shopify/Customer/42" } } };
			}
			const bytes = encoder.encode(JSON.stringify(value));
			return {
				status: 200,
				contentLength: bytes.byteLength,
				body: (async function* () {
					yield bytes;
				})(),
			};
		},
	});
	const organizations = new InMemoryOrganizationRepository();
	const organization = await organizations.createOrganization({
		name: "Benchmark",
		slug: "benchmark",
	});
	const repository = new InMemoryCustomerAccountRepository();
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ benchmark: Buffer.alloc(32, 9).toString("base64") }),
		"benchmark",
	);
	if (!keyring) throw new Error("Benchmark keyring unavailable.");
	const ttl = mode === "warm" ? 300_000 : 1;
	const service = new CustomerAccountService(
		repository,
		organizations,
		keyring,
		{
			publicOrigin: "https://festival.example.com",
			now: () => now,
			transport,
			discoveryCacheTtlMs: ttl,
			jwksCacheTtlMs: ttl,
		},
	);
	await service.saveAndVerify(organization.id, organization.slug, {
		storefrontDomain: "store.example.com",
		clientId: "benchmark-client",
		clientSecret: "benchmark-secret",
	});
	resolverCalls = 0;
	upstream.discovery = upstream.jwks = upstream.token = upstream.graphql = 0;
	const latencies: number[] = [];
	const cpuStart = process.cpuUsage();
	const heapStart = process.memoryUsage().heapUsed;
	const started = performance.now();
	for (let offset = 0; offset < ITERATIONS; offset += CONCURRENCY) {
		await Promise.all(
			Array.from(
				{ length: Math.min(CONCURRENCY, ITERATIONS - offset) },
				async (_, index) => {
					const id = `${offset + index}`;
					if (mode === "uncached") now = new Date(now.getTime() + 2);
					const itemStarted = performance.now();
					const authorization = new URL(await service.start("benchmark"));
					nonceByCode.set(id, authorization.searchParams.get("nonce") ?? "");
					await service.callback(
						authorization.searchParams.get("state") ?? "",
						id,
					);
					latencies.push(performance.now() - itemStarted);
				},
			),
		);
	}
	const elapsedMs = performance.now() - started;
	const cpu = process.cpuUsage(cpuStart);
	return {
		mode,
		iterations: ITERATIONS,
		concurrency: CONCURRENCY,
		throughputPerSecond: ITERATIONS / (elapsedMs / 1_000),
		p50Ms: percentile(latencies, 0.5),
		p95Ms: percentile(latencies, 0.95),
		cpuMs: (cpu.user + cpu.system) / 1_000,
		heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
		resolverCalls,
		upstream,
		cacheMetrics: service.cacheMetrics(),
	};
}

const uncached = await run("uncached");
const warm = await run("warm");
console.log(
	JSON.stringify(
		{ scope: "Festival-controlled mocked Shopify responses", uncached, warm },
		null,
		2,
	),
);
if (
	warm.throughputPerSecond < uncached.throughputPerSecond ||
	warm.p95Ms > uncached.p95Ms ||
	warm.upstream.discovery !== 0 ||
	warm.upstream.jwks !== 1
) {
	throw new Error("Warm Customer Account cache performance acceptance failed.");
}
