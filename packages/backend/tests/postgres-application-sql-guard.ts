/** Fail closed; forwarded SQL is never rewritten. Current fixtures need no
 * semicolons inside literals or leading comments, so those are rejected too. */
export function assertApplicationFixtureSql(query: string): void {
	for (const statement of query.split(";")) {
		const trimmed = statement.trim();
		if (!trimmed) continue;
		if (!/^(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(trimmed))
			throw new Error(
				"Application fixture permits repository DML/SELECT only.",
			);
	}
}
