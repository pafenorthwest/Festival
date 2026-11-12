const admissions = new Map<string, Promise<void>>();

/** Customer admission is independent from capacity allocation and provider work. */
export async function withInMemoryCheckoutAdmissionLock<T>(
	organizationId: string,
	customerId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const key = JSON.stringify([organizationId, customerId]);
	const previous = admissions.get(key) ?? Promise.resolve();
	let release = () => {};
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	admissions.set(key, next);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (admissions.get(key) === next) admissions.delete(key);
	}
}
