import { describe, expect, it, spyOn } from "bun:test";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
	ShopifySecretKeyringError,
} from "../src/shopify/encryption.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const CONTEXT = {
	organizationId: "organization-a",
	purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
} as const;

function keyring(
	keys: Record<string, string> = { "festival-2026-08": KEY_A },
	activeKeyId = "festival-2026-08",
) {
	const result = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify(keys),
		activeKeyId,
	);
	if (!result) {
		throw new Error("Expected configured keyring.");
	}
	return result;
}

function errorCode(action: () => unknown) {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(ShopifySecretKeyringError);
		return (error as ShopifySecretKeyringError).code;
	}
	throw new Error("Expected action to fail.");
}

describe("ShopifySecretKeyring configuration", () => {
	it("disables Shopify only when both configuration values are absent", () => {
		expect(ShopifySecretKeyring.fromEnvironment(undefined, undefined)).toBe(
			undefined,
		);
		expect(() =>
			ShopifySecretKeyring.fromEnvironment(
				JSON.stringify({ active: KEY_A }),
				undefined,
			),
		).toThrow("Shopify secret keyring configuration is invalid.");
		expect(() =>
			ShopifySecretKeyring.fromEnvironment(undefined, "active"),
		).toThrow("Shopify secret keyring configuration is invalid.");
	});

	it("accepts a valid multi-key configuration and approved key IDs", () => {
		expect(
			ShopifySecretKeyring.fromEnvironment(
				JSON.stringify({ "A.1_x-y": KEY_A, previous: KEY_B }),
				"A.1_x-y",
			),
		).toBeInstanceOf(ShopifySecretKeyring);
	});

	it.each([
		["malformed JSON", "{", "active"],
		["null", "null", "active"],
		["array", "[]", "active"],
		["empty map", "{}", "active"],
		["invalid key ID", JSON.stringify({ "-bad": KEY_A }), "-bad"],
		[
			"oversized key ID",
			JSON.stringify({ [`a${"b".repeat(64)}`]: KEY_A }),
			`a${"b".repeat(64)}`,
		],
		["unknown active key", JSON.stringify({ known: KEY_A }), "missing"],
		["non-string key", JSON.stringify({ active: 4 }), "active"],
		["invalid Base64", JSON.stringify({ active: "***" }), "active"],
		[
			"non-canonical Base64",
			JSON.stringify({ active: `${KEY_A}\n` }),
			"active",
		],
		[
			"wrong key length",
			JSON.stringify({ active: Buffer.alloc(31).toString("base64") }),
			"active",
		],
	] as const)("rejects %s", (_name, keysJson, activeKeyId) => {
		expect(() =>
			ShopifySecretKeyring.fromEnvironment(keysJson, activeKeyId),
		).toThrow("Shopify secret keyring configuration is invalid.");
	});

	it("does not include configuration or key material in errors", () => {
		const canary = Buffer.alloc(31, 9).toString("base64");
		try {
			ShopifySecretKeyring.fromEnvironment(
				JSON.stringify({ "private-key-id": canary }),
				"private-key-id",
			);
		} catch (error) {
			const serialized = JSON.stringify(error);
			const message = error instanceof Error ? error.message : String(error);
			expect(`${serialized}${message}`).not.toContain(canary);
			expect(message).not.toContain("private-key-id");
		}
	});
});

describe("ShopifySecretKeyring encryption", () => {
	it("round trips with a bounded versioned tenant-bound envelope", () => {
		const ring = keyring();
		const encrypted = ring.encrypt("client-secret", CONTEXT);
		const envelope = JSON.parse(encrypted) as Record<string, unknown>;

		expect(envelope.version).toBe(2);
		expect(envelope.keyId).toBe("festival-2026-08");
		expect(envelope.organizationId).toBe("organization-a");
		expect(envelope.purpose).toBe(SHOPIFY_CLIENT_SECRET_PURPOSE);
		expect(Buffer.from(String(envelope.iv), "base64")).toHaveLength(12);
		expect(Buffer.from(String(envelope.tag), "base64")).toHaveLength(16);
		expect(String(envelope.ciphertext)).not.toContain("client-secret");
		expect(ring.decrypt(encrypted, CONTEXT)).toBe("client-secret");
	});

	it("uses a fresh IV for repeated encryption", () => {
		const ring = keyring();
		const first = ring.encrypt("client-secret", CONTEXT);
		const second = ring.encrypt("client-secret", CONTEXT);
		expect(first).not.toBe(second);
	});

	it("rejects invalid context and oversized plaintext before encryption", () => {
		const ring = keyring();
		expect(
			errorCode(() =>
				ring.encrypt("client-secret", {
					...CONTEXT,
					organizationId: "",
				}),
			),
		).toBe("invalid_context");
		expect(errorCode(() => ring.encrypt("x".repeat(8_193), CONTEXT))).toBe(
			"invalid_envelope",
		);
	});

	it("uses the new active key while retaining previous-key reads", () => {
		const previous = keyring({ previous: KEY_A, current: KEY_B }, "previous");
		const encryptedWithPrevious = previous.encrypt("client-secret", CONTEXT);
		const current = keyring({ previous: KEY_A, current: KEY_B }, "current");
		const encryptedWithCurrent = current.encrypt("client-secret", CONTEXT);

		expect(JSON.parse(encryptedWithPrevious).keyId).toBe("previous");
		expect(JSON.parse(encryptedWithCurrent).keyId).toBe("current");
		expect(current.decrypt(encryptedWithPrevious, CONTEXT)).toBe(
			"client-secret",
		);
	});

	it("rejects unavailable keys and cross-tenant or purpose use", () => {
		const encrypted = keyring({ previous: KEY_A }, "previous").encrypt(
			"client-secret",
			CONTEXT,
		);
		expect(
			errorCode(() =>
				keyring({ current: KEY_B }, "current").decrypt(encrypted, CONTEXT),
			),
		).toBe("unavailable_key");
		expect(
			errorCode(() =>
				keyring().decrypt(encrypted, {
					...CONTEXT,
					organizationId: "organization-b",
				}),
			),
		).toBe("context_mismatch");
		expect(
			errorCode(() =>
				keyring().decrypt(encrypted, {
					...CONTEXT,
					purpose: "other-purpose" as typeof SHOPIFY_CLIENT_SECRET_PURPOSE,
				}),
			),
		).toBe("invalid_context");
	});

	it.each([
		"version",
		"organizationId",
		"purpose",
		"iv",
		"tag",
		"ciphertext",
	] as const)("rejects tampered %s", (field) => {
		const ring = keyring();
		const envelope = JSON.parse(
			ring.encrypt("client-secret", CONTEXT),
		) as Record<string, unknown>;
		if (field === "version") envelope.version = 3;
		if (field === "organizationId") envelope.organizationId = "organization-b";
		if (field === "purpose") envelope.purpose = "other-purpose";
		if (field === "iv") envelope.iv = Buffer.alloc(12, 4).toString("base64");
		if (field === "tag") envelope.tag = Buffer.alloc(16, 4).toString("base64");
		if (field === "ciphertext") {
			envelope.ciphertext = Buffer.from("modified").toString("base64");
		}
		expect(() => ring.decrypt(JSON.stringify(envelope), CONTEXT)).toThrow();
	});

	it("keeps plaintext, key material, and envelope fields out of crypto errors", () => {
		const ring = keyring();
		const plaintext = "private-client-secret-canary";
		const encrypted = ring.encrypt(plaintext, CONTEXT);
		const envelope = JSON.parse(encrypted) as Record<string, unknown>;
		const iv = String(envelope.iv);
		const tag = String(envelope.tag);
		const ciphertext = String(envelope.ciphertext);
		envelope.tag = Buffer.alloc(16, 7).toString("base64");

		let caught: unknown;
		try {
			ring.decrypt(JSON.stringify(envelope), CONTEXT);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ShopifySecretKeyringError);
		const output = `${JSON.stringify(caught)}${
			caught instanceof Error ? caught.message : String(caught)
		}`;
		expect(output).not.toContain(plaintext);
		expect(output).not.toContain(KEY_A);
		expect(output).not.toContain(encrypted);
		expect(output).not.toContain(iv);
		expect(output).not.toContain(tag);
		expect(output).not.toContain(ciphertext);
	});

	it("authenticates embedded organization context even when the caller matches a tampered value", () => {
		const ring = keyring();
		const envelope = JSON.parse(
			ring.encrypt("client-secret", CONTEXT),
		) as Record<string, unknown>;
		envelope.organizationId = "organization-b";

		expect(
			errorCode(() =>
				ring.decrypt(JSON.stringify(envelope), {
					...CONTEXT,
					organizationId: "organization-b",
				}),
			),
		).toBe("authentication_failed");
	});

	it("does not write cryptographic material to console output", () => {
		const captured: unknown[][] = [];
		const capture = (...values: unknown[]) => {
			captured.push(values);
		};
		const logSpy = spyOn(console, "log").mockImplementation(capture);
		const warnSpy = spyOn(console, "warn").mockImplementation(capture);
		const errorSpy = spyOn(console, "error").mockImplementation(capture);
		const rawConfiguration = JSON.stringify({ "private-key": KEY_A });
		const plaintext = "console-client-secret-canary";
		let encrypted = "";
		let envelope: Record<string, unknown> = {};
		let decryptFailed = false;

		try {
			const ring = ShopifySecretKeyring.fromEnvironment(
				rawConfiguration,
				"private-key",
			);
			if (!ring) throw new Error("Expected configured keyring.");
			encrypted = ring.encrypt(plaintext, CONTEXT);
			envelope = JSON.parse(encrypted) as Record<string, unknown>;
			envelope.tag = Buffer.alloc(16, 6).toString("base64");
			try {
				ring.decrypt(JSON.stringify(envelope), CONTEXT);
			} catch (error) {
				decryptFailed = true;
				expect(error).toBeInstanceOf(ShopifySecretKeyringError);
			}
		} finally {
			logSpy.mockRestore();
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}

		expect(decryptFailed).toBeTrue();
		const output = JSON.stringify(captured);
		expect(output).not.toContain(rawConfiguration);
		expect(output).not.toContain(KEY_A);
		expect(output).not.toContain(Buffer.alloc(32, 1).toString("hex"));
		expect(output).not.toContain(plaintext);
		expect(output).not.toContain(encrypted);
		expect(output).not.toContain(String(envelope.iv));
		expect(output).not.toContain(String(envelope.tag));
		expect(output).not.toContain(String(envelope.ciphertext));
	});

	it.each([
		"v1:legacy:data",
		"{",
		"[]",
		JSON.stringify({}),
		JSON.stringify({
			version: 2,
			keyId: "active",
			organizationId: "organization-a",
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			iv: Buffer.alloc(11).toString("base64"),
			tag: Buffer.alloc(16).toString("base64"),
			ciphertext: Buffer.from("secret").toString("base64"),
		}),
		JSON.stringify({
			version: 2,
			keyId: "active",
			organizationId: "organization-a",
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			iv: Buffer.alloc(12).toString("base64"),
			tag: Buffer.alloc(16).toString("base64"),
			ciphertext: "not-base64***",
		}),
		JSON.stringify({
			version: 2,
			keyId: "active",
			organizationId: "organization-a",
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			iv: Buffer.alloc(12).toString("base64"),
			tag: Buffer.alloc(16).toString("base64"),
			ciphertext: `${Buffer.from("secret").toString("base64")}\n`,
		}),
		JSON.stringify({
			version: 2,
			keyId: "active",
			organizationId: "organization-a",
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			iv: Buffer.alloc(12).toString("base64"),
			tag: Buffer.alloc(16).toString("base64"),
			ciphertext: Buffer.from("secret").toString("base64"),
			extra: true,
		}),
		"x".repeat(32_769),
	])("rejects malformed envelope %#", (value) => {
		expect(errorCode(() => keyring().decrypt(value, CONTEXT))).toBe(
			"invalid_envelope",
		);
	});
});
