import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AES_256_KEY_BYTES = 32;
const IV_BYTES = 12;

export class AesSecretEncryptor {
	private readonly key: Buffer;

	constructor(base64Key: string) {
		const key = Buffer.from(base64Key.trim(), "base64");
		if (key.length !== AES_256_KEY_BYTES) {
			throw new Error("AES_ENCRYPTION_KEY must decode to 32 bytes.");
		}

		this.key = key;
	}

	encrypt(plaintext: string): string {
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv);
		const encrypted = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		const authTag = cipher.getAuthTag();

		return [
			"v1",
			iv.toString("base64"),
			authTag.toString("base64"),
			encrypted.toString("base64"),
		].join(":");
	}

	decrypt(ciphertext: string): string {
		const [version, ivBase64, authTagBase64, encryptedBase64] =
			ciphertext.split(":");
		if (version !== "v1" || !ivBase64 || !authTagBase64 || !encryptedBase64) {
			throw new Error("Encrypted secret has an unsupported format.");
		}

		const decipher = createDecipheriv(
			"aes-256-gcm",
			this.key,
			Buffer.from(ivBase64, "base64"),
		);
		decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

		return Buffer.concat([
			decipher.update(Buffer.from(encryptedBase64, "base64")),
			decipher.final(),
		]).toString("utf8");
	}
}
