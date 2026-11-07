export class AppError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
	}
}

export default AppError;
