// In-memory admission awaits repository reads, so mutations must share its gate.
let pending: Promise<unknown> = Promise.resolve();

export async function withInMemoryCapacityLock<T>(
	operation: () => T | Promise<T>,
): Promise<T> {
	const previous = pending;
	let release!: () => void;
	pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await operation();
	} finally {
		release();
	}
}
