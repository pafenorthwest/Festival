import type {
	PendingClassCheckoutDto,
	PendingClassCheckoutResponse,
	ResumePendingClassCheckoutResponse,
} from "@festival/common";
import { batch, createSignal } from "solid-js";

interface CheckoutOwner {
	slug: string;
	csrfToken: string;
}

export interface PendingCheckoutDependencies {
	read: (slug: string) => Promise<PendingClassCheckoutResponse>;
	resume: (
		slug: string,
		reference: string,
		csrfToken: string,
		submissionKey?: string,
	) => Promise<ResumePendingClassCheckoutResponse>;
}

export interface PendingCheckoutResumeResult {
	checkoutUrl: string | null;
	submissionMatched?: boolean;
	resolved: boolean;
}

/** Shopify observations are scoped to the current customer session, never browser storage. */
export function createPendingCheckoutState(deps: PendingCheckoutDependencies) {
	const [checkout, setCheckout] = createSignal<PendingClassCheckoutDto | null>(
		null,
	);
	const [phase, setPhase] = createSignal<
		"idle" | "checking" | "ready" | "error"
	>("idle");
	const [error, setError] = createSignal<string | null>(null);
	const [isResuming, setIsResuming] = createSignal(false);
	const [owner, setOwnerSignal] = createSignal<CheckoutOwner | null>(null);
	let generation = 0;
	let readRequest: { generation: number; promise: Promise<void> } | null = null;
	const handoffs = new Map<
		string,
		{ owner: CheckoutOwner; completions: Map<string, () => void> }
	>();
	const ownerKey = (value: CheckoutOwner) =>
		JSON.stringify([value.slug, value.csrfToken]);

	function clear(preserveHandoffs = false) {
		generation++;
		readRequest = null;
		if (!preserveHandoffs) handoffs.clear();
		batch(() => {
			setOwnerSignal(null);
			setCheckout(null);
			setPhase("idle");
			setError(null);
			setIsResuming(false);
		});
	}

	function bindOwner(slug: string, csrfToken: string) {
		const current = owner();
		if (current?.slug === slug && current.csrfToken === csrfToken) return;
		for (const [key, entry] of handoffs) {
			if (entry.owner.slug === slug && entry.owner.csrfToken !== csrfToken) {
				handoffs.delete(key);
			}
		}
		generation++;
		readRequest = null;
		batch(() => {
			setOwnerSignal({ slug, csrfToken });
			setCheckout(null);
			setPhase("checking");
			setError(null);
			setIsResuming(false);
		});
	}

	/** Invalidate only the organization whose browser workspace is being cleared. */
	function clearOrganization(slug: string) {
		for (const [key, entry] of handoffs) {
			if (entry.owner.slug === slug) handoffs.delete(key);
		}
		if (owner()?.slug === slug) clear(true);
	}

	function refresh(): Promise<void> {
		const current = owner();
		if (!current) return Promise.resolve();
		if (readRequest?.generation === generation) return readRequest.promise;
		const expectedGeneration = generation;
		const isCurrent = () =>
			generation === expectedGeneration && owner() === current;
		batch(() => {
			setPhase("checking");
			setError(null);
		});
		const request = {
			generation: expectedGeneration,
			promise: Promise.resolve(),
		};
		request.promise = (async () => {
			try {
				const response = await Promise.resolve().then(() =>
					deps.read(current.slug),
				);
				if (!isCurrent()) return;
				if (!response || !Object.hasOwn(response, "checkout")) {
					throw new Error("Checkout status could not be verified.");
				}
				if (response.checkout === undefined) {
					throw new Error("Checkout status could not be verified.");
				}
				batch(() => {
					setCheckout(response.checkout);
					setPhase("ready");
					if (response.checkout === null) {
						const handoff = handoffs.get(ownerKey(current));
						handoffs.delete(ownerKey(current));
						for (const complete of handoff?.completions.values() ?? []) {
							complete();
						}
					}
				});
			} catch (failure) {
				if (!isCurrent()) return;
				batch(() => {
					setPhase("error");
					setError(
						failure instanceof Error
							? failure.message
							: "Checkout status could not be verified. Please try again.",
					);
				});
			} finally {
				if (readRequest === request) readRequest = null;
			}
		})();
		readRequest = request;
		return request.promise;
	}

	/** A checkout outcome supersedes reads begun before that attempt was recorded. */
	function invalidateAndRefresh(): Promise<void> {
		if (!owner()) return Promise.resolve();
		generation++;
		readRequest = null;
		return refresh();
	}

	/** Retain submitted lines until a later authoritative read reports no unresolved checkout. */
	function markHandoff(key: string, complete: () => void) {
		const current = owner();
		if (!current) return;
		const handoff = handoffs.get(ownerKey(current)) ?? {
			owner: current,
			completions: new Map<string, () => void>(),
		};
		handoff.completions.set(key, complete);
		handoffs.set(ownerKey(current), handoff);
		// A read begun before cart creation must not resolve the new handoff.
		generation++;
		readRequest = null;
		batch(() => {
			setPhase("checking");
			setError(null);
		});
	}

	async function resumeWithProof(
		submissionKey?: string,
	): Promise<PendingCheckoutResumeResult | null> {
		const current = owner();
		const pending = checkout();
		if (
			!current ||
			!pending?.resumeAllowed ||
			phase() !== "ready" ||
			isResuming()
		)
			return null;
		const expectedGeneration = generation;
		const isCurrent = () =>
			generation === expectedGeneration && owner() === current;
		setIsResuming(true);
		setError(null);
		try {
			const result = await deps.resume(
				current.slug,
				pending.recoveryReference,
				current.csrfToken,
				submissionKey,
			);
			if (!isCurrent()) return null;
			if (
				phase() === "ready" &&
				checkout() === null &&
				Boolean(submissionKey) &&
				result.submissionMatched === true
			) {
				return { checkoutUrl: null, submissionMatched: true, resolved: true };
			}
			if (
				checkout()?.recoveryReference !== pending.recoveryReference ||
				!checkout()?.resumeAllowed ||
				phase() !== "ready"
			)
				return null;
			if (new URL(result.checkoutUrl).protocol !== "https:") {
				throw new Error("Checkout URL could not be verified.");
			}
			return { ...result, resolved: false };
		} catch (failure) {
			if (!isCurrent()) return null;
			await refresh();
			if (isCurrent()) {
				setError(
					failure instanceof Error
						? failure.message
						: "Checkout could not be resumed. Please check its status.",
				);
			}
			return null;
		} finally {
			if (isCurrent()) setIsResuming(false);
		}
	}

	async function resume(): Promise<string | null> {
		return (await resumeWithProof())?.checkoutUrl ?? null;
	}

	return {
		checkout,
		phase,
		error,
		isResuming,
		ownerSlug: () => owner()?.slug ?? null,
		isChecking: () => phase() === "checking",
		isBlocked: () =>
			owner() !== null && (phase() !== "ready" || checkout() !== null),
		bindOwner,
		clear,
		clearOrganization,
		refresh,
		invalidateAndRefresh,
		markHandoff,
		resume,
		resumeWithProof,
	};
}

export type PendingCheckoutState = ReturnType<
	typeof createPendingCheckoutState
>;
