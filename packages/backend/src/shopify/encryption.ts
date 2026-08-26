import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AES_256_KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = 2;
const MAX_ENVELOPE_CHARACTERS = 32_768;
const MAX_PLAINTEXT_BYTES = 8_192;
const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES;
const MAX_ORGANIZATION_ID_CHARACTERS = 256;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CANONICAL_BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const SHOPIFY_CLIENT_SECRET_PURPOSE = "shopify-client-secret" as const;
export const SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE =
	"shopify-storefront-private-token" as const;
export const SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE =
	"shopify-customer-client-secret" as const;
export const SHOPIFY_CUSTOMER_TOKENS_PURPOSE =
	"shopify-customer-tokens" as const;

export type ShopifySecretPurpose =
	| typeof SHOPIFY_CLIENT_SECRET_PURPOSE
	| typeof SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE
	| typeof SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE
	| typeof SHOPIFY_CUSTOMER_TOKENS_PURPOSE;

export interface ShopifyClientSecretContext {
	organizationId: string;
	purpose: ShopifySecretPurpose;
}

export type ShopifySecretKeyringErrorCode =
	| "invalid_configuration"
	| "invalid_context"
	| "invalid_envelope"
	| "unavailable_key"
	| "context_mismatch"
	| "authentication_failed";

const ERROR_MESSAGES: Record<ShopifySecretKeyringErrorCode, string> = {
	invalid_configuration: "Shopify secret keyring configuration is invalid.",
	invalid_context: "Shopify secret encryption context is invalid.",
	invalid_envelope: "Shopify encrypted secret envelope is invalid.",
	unavailable_key: "Shopify encrypted secret key is unavailable.",
	context_mismatch: "Shopify encrypted secret context does not match.",
	authentication_failed: "Shopify encrypted secret authentication failed.",
};

export class ShopifySecretKeyringError extends Error {
	constructor(readonly code: ShopifySecretKeyringErrorCode) {
		super(ERROR_MESSAGES[code]);
		this.name = "ShopifySecretKeyringError";
	}
}

interface ShopifySecretEnvelope {
	version: typeof ENVELOPE_VERSION;
	keyId: string;
	organizationId: string;
	purpose: ShopifySecretPurpose;
	iv: string;
	tag: string;
	ciphertext: string;
}

const ENVELOPE_KEYS = [
	"ciphertext",
	"iv",
	"keyId",
	"organizationId",
	"purpose",
	"tag",
	"version",
] as const;

function configurationError(): never {
	throw new ShopifySecretKeyringError("invalid_configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeCanonicalBase64(value: string, expectedBytes?: number): Buffer {
	if (!value || !CANONICAL_BASE64_PATTERN.test(value)) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	const decoded = Buffer.from(value, "base64");
	if (decoded.toString("base64") !== value) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}
	if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	return decoded;
}

function decodeConfiguredKey(value: unknown): Buffer {
	if (typeof value !== "string" || !CANONICAL_BASE64_PATTERN.test(value)) {
		configurationError();
	}

	const decoded = Buffer.from(value, "base64");
	if (
		decoded.length !== AES_256_KEY_BYTES ||
		decoded.toString("base64") !== value
	) {
		configurationError();
	}

	return Buffer.from(decoded);
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
			return true;
		}
	}
	return false;
}

function assertContext(
	context: ShopifyClientSecretContext,
): ShopifyClientSecretContext {
	if (
		!context ||
		typeof context.organizationId !== "string" ||
		context.organizationId.length === 0 ||
		context.organizationId.length > MAX_ORGANIZATION_ID_CHARACTERS ||
		containsControlCharacter(context.organizationId) ||
		![
			SHOPIFY_CLIENT_SECRET_PURPOSE,
			SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
			SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
			SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
		].includes(context.purpose)
	) {
		throw new ShopifySecretKeyringError("invalid_context");
	}

	return context;
}

function authenticatedContext(context: ShopifyClientSecretContext): Buffer {
	return Buffer.from(
		JSON.stringify({
			version: ENVELOPE_VERSION,
			organizationId: context.organizationId,
			purpose: context.purpose,
		}),
		"utf8",
	);
}

function serializeEnvelope(envelope: ShopifySecretEnvelope): string {
	const serialized = JSON.stringify(envelope);
	if (serialized.length > MAX_ENVELOPE_CHARACTERS) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}
	return serialized;
}

function parseEnvelope(serialized: string): {
	envelope: ShopifySecretEnvelope;
	iv: Buffer;
	tag: Buffer;
	ciphertext: Buffer;
} {
	if (
		typeof serialized !== "string" ||
		serialized.length === 0 ||
		serialized.length > MAX_ENVELOPE_CHARACTERS
	) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	let candidate: unknown;
	try {
		candidate = JSON.parse(serialized);
	} catch {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}
	if (!isRecord(candidate)) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	const keys = Object.keys(candidate).sort();
	if (
		keys.length !== ENVELOPE_KEYS.length ||
		keys.some((key, index) => key !== ENVELOPE_KEYS[index])
	) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	if (
		candidate.version !== ENVELOPE_VERSION ||
		typeof candidate.keyId !== "string" ||
		!KEY_ID_PATTERN.test(candidate.keyId) ||
		typeof candidate.organizationId !== "string" ||
		typeof candidate.purpose !== "string" ||
		![
			SHOPIFY_CLIENT_SECRET_PURPOSE,
			SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
			SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
			SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
		].includes(candidate.purpose as ShopifySecretPurpose) ||
		typeof candidate.iv !== "string" ||
		typeof candidate.tag !== "string" ||
		typeof candidate.ciphertext !== "string"
	) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	assertContext({
		organizationId: candidate.organizationId,
		purpose: candidate.purpose as ShopifySecretPurpose,
	});
	const iv = decodeCanonicalBase64(candidate.iv, IV_BYTES);
	const tag = decodeCanonicalBase64(candidate.tag, AUTH_TAG_BYTES);
	const ciphertext = decodeCanonicalBase64(candidate.ciphertext);
	if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
		throw new ShopifySecretKeyringError("invalid_envelope");
	}

	return {
		envelope: candidate as unknown as ShopifySecretEnvelope,
		iv,
		tag,
		ciphertext,
	};
}

export class ShopifySecretKeyring {
	private readonly keys: ReadonlyMap<string, Buffer>;

	private constructor(
		keys: ReadonlyMap<string, Buffer>,
		private readonly activeKeyId: string,
	) {
		this.keys = new Map(
			[...keys].map(([keyId, key]) => [keyId, Buffer.from(key)]),
		);
	}

	static fromEnvironment(
		keysJson: string | undefined,
		activeKeyId: string | undefined,
	): ShopifySecretKeyring | undefined {
		if (keysJson === undefined && activeKeyId === undefined) {
			return undefined;
		}
		if (keysJson === undefined || activeKeyId === undefined) {
			configurationError();
		}

		let candidate: unknown;
		try {
			candidate = JSON.parse(keysJson);
		} catch {
			configurationError();
		}
		if (!isRecord(candidate) || Object.keys(candidate).length === 0) {
			configurationError();
		}
		if (!KEY_ID_PATTERN.test(activeKeyId)) {
			configurationError();
		}

		const keys = new Map<string, Buffer>();
		for (const [keyId, encodedKey] of Object.entries(candidate)) {
			if (!KEY_ID_PATTERN.test(keyId)) {
				configurationError();
			}
			keys.set(keyId, decodeConfiguredKey(encodedKey));
		}
		if (!keys.has(activeKeyId)) {
			configurationError();
		}

		return new ShopifySecretKeyring(keys, activeKeyId);
	}

	encrypt(plaintext: string, context: ShopifyClientSecretContext): string {
		const validContext = assertContext(context);
		if (
			typeof plaintext !== "string" ||
			Buffer.byteLength(plaintext, "utf8") === 0 ||
			Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES
		) {
			throw new ShopifySecretKeyringError("invalid_envelope");
		}

		const key = this.keys.get(this.activeKeyId);
		if (!key) {
			throw new ShopifySecretKeyringError("unavailable_key");
		}
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv("aes-256-gcm", key, iv, {
			authTagLength: AUTH_TAG_BYTES,
		});
		cipher.setAAD(authenticatedContext(validContext));
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);

		return serializeEnvelope({
			version: ENVELOPE_VERSION,
			keyId: this.activeKeyId,
			organizationId: validContext.organizationId,
			purpose: validContext.purpose,
			iv: iv.toString("base64"),
			tag: cipher.getAuthTag().toString("base64"),
			ciphertext: ciphertext.toString("base64"),
		});
	}

	decrypt(serialized: string, context: ShopifyClientSecretContext): string {
		const validContext = assertContext(context);
		const { envelope, iv, tag, ciphertext } = parseEnvelope(serialized);
		if (
			envelope.organizationId !== validContext.organizationId ||
			envelope.purpose !== validContext.purpose
		) {
			throw new ShopifySecretKeyringError("context_mismatch");
		}

		const key = this.keys.get(envelope.keyId);
		if (!key) {
			throw new ShopifySecretKeyringError("unavailable_key");
		}

		try {
			const decipher = createDecipheriv("aes-256-gcm", key, iv, {
				authTagLength: AUTH_TAG_BYTES,
			});
			decipher.setAAD(authenticatedContext(validContext));
			decipher.setAuthTag(tag);
			return Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]).toString("utf8");
		} catch {
			throw new ShopifySecretKeyringError("authentication_failed");
		}
	}
}
