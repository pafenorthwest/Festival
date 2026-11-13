import { createEffect, createSignal } from "solid-js";
import {
	type CanonicalWork,
	claimRepertoireReview,
	flagRepertoireReview,
	normalizeRepertoireReview,
	type RepertoireFlagReason,
	type RepertoireReviewItem,
	resolveRepertoireFlag,
	searchRepertoireCatalog,
	unclaimRepertoireReview,
} from "../../lib/api.js";

export interface UseMusicReviewModalStateProps {
	isOpen: boolean;
	item: RepertoireReviewItem | null;
	slug: string;
	currentUserId?: string | null;
	onUpdated: (updatedItem: RepertoireReviewItem) => void;
}

export function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function useMusicReviewModalState(props: UseMusicReviewModalStateProps) {
	const [normalizedTitle, setNormalizedTitle] = createSignal("");
	const [normalizedComposer, setNormalizedComposer] = createSignal("");
	const [imslpUrl, setImslpUrl] = createSignal("");
	const [reviewerNotes, setReviewerNotes] = createSignal("");
	const [canonicalWorkId, setCanonicalWorkId] = createSignal<string | null>(
		null,
	);
	const [catalogSuggestions, setCatalogSuggestions] = createSignal<
		CanonicalWork[]
	>([]);
	const [isSearchingCatalog, setIsSearchingCatalog] = createSignal(false);
	const [showCatalogDropdown, setShowCatalogDropdown] = createSignal(false);

	const [isFlagging, setIsFlagging] = createSignal(false);
	const [flagReason, setFlagReason] =
		createSignal<RepertoireFlagReason>("ambiguous_title");
	const [flagNotes, setFlagNotes] = createSignal("");

	const [isResolving, setIsResolving] = createSignal(false);
	const [resolutionNotes, setResolutionNotes] = createSignal("");

	const [actionPending, setActionPending] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [successMessage, setSuccessMessage] = createSignal<string | null>(null);

	createEffect(() => {
		const item = props.item;
		if (item && props.isOpen) {
			setNormalizedTitle(
				item.normalizedTitle || item.rawTitle || item.submittedTitle || "",
			);
			setNormalizedComposer(
				item.normalizedComposer ||
					item.rawComposer ||
					item.submittedComposer ||
					"",
			);
			setImslpUrl(item.imslpUrl || "");
			setReviewerNotes(item.reviewerNotes || "");
			setCanonicalWorkId(item.canonicalWorkId || item.resolvedWorkId || null);
			setCatalogSuggestions([]);
			setShowCatalogDropdown(false);
			setIsFlagging(false);
			setIsResolving(false);
			setErrorMessage(null);
			setSuccessMessage(null);
		}
	});

	const isClaimedByMe = () => {
		const item = props.item;
		if (!item?.claimedByUid) return false;
		return item.claimedByUid === props.currentUserId;
	};

	async function runReviewAction(
		action: (item: RepertoireReviewItem) => Promise<RepertoireReviewItem>,
		successText: string,
		fallbackError: string,
		onSuccess?: () => void,
	) {
		const item = props.item;
		if (!item) return;
		setActionPending(true);
		setErrorMessage(null);
		try {
			const updatedItem = await action(item);
			setSuccessMessage(successText);
			onSuccess?.();
			props.onUpdated(updatedItem);
		} catch (err) {
			setErrorMessage(err instanceof Error ? err.message : fallbackError);
		} finally {
			setActionPending(false);
		}
	}

	async function handleCatalogSearch(query: string) {
		if (!query.trim() || query.length < 2) {
			setCatalogSuggestions([]);
			setShowCatalogDropdown(false);
			return;
		}
		setIsSearchingCatalog(true);
		try {
			const res = await searchRepertoireCatalog(props.slug, query.trim(), {
				limit: 5,
			});
			setCatalogSuggestions(res.works);
			setShowCatalogDropdown(res.works.length > 0);
		} catch {
			setCatalogSuggestions([]);
		} finally {
			setIsSearchingCatalog(false);
		}
	}

	function handleSelectCatalogWork(work: CanonicalWork) {
		setNormalizedTitle(work.title);
		if (work.composerName) {
			setNormalizedComposer(work.composerName);
		}
		if (work.imslpUrl) {
			setImslpUrl(work.imslpUrl);
		}
		setCanonicalWorkId(work.id);
		setShowCatalogDropdown(false);
	}

	async function handleClaim() {
		await runReviewAction(
			async (item) => (await claimRepertoireReview(props.slug, item.id)).item,
			"Review claimed successfully.",
			"Failed to claim review.",
		);
	}

	async function handleUnclaim() {
		await runReviewAction(
			async (item) => (await unclaimRepertoireReview(props.slug, item.id)).item,
			"Review released.",
			"Failed to release review.",
		);
	}

	async function handleNormalizeAndApprove() {
		if (!props.item) return;
		if (!normalizedTitle().trim()) {
			setErrorMessage("Canonical title is required.");
			return;
		}
		if (!normalizedComposer().trim()) {
			setErrorMessage("Canonical composer is required.");
			return;
		}
		if (imslpUrl().trim() && !isValidHttpUrl(imslpUrl().trim())) {
			setErrorMessage("IMSLP URL must be a valid HTTP or HTTPS URL.");
			return;
		}

		await runReviewAction(
			async (item) =>
				(
					await normalizeRepertoireReview(props.slug, item.id, {
						normalizedTitle: normalizedTitle().trim(),
						normalizedComposer: normalizedComposer().trim(),
						imslpUrl: imslpUrl().trim() || null,
						notes: reviewerNotes().trim() || null,
						canonicalWorkId: canonicalWorkId(),
						status: "approved",
					})
				).item,
			"Repertoire normalized and approved.",
			"Failed to normalize review.",
		);
	}

	async function handleConfirmFlag() {
		await runReviewAction(
			async (item) =>
				(
					await flagRepertoireReview(props.slug, item.id, {
						reason: flagReason(),
						notes: flagNotes().trim() || null,
					})
				).item,
			"Review item flagged.",
			"Failed to flag review.",
			() => setIsFlagging(false),
		);
	}

	async function handleConfirmResolve() {
		await runReviewAction(
			async (item) =>
				(
					await resolveRepertoireFlag(props.slug, item.id, {
						resolutionNotes: resolutionNotes().trim() || null,
						status: "in_review",
					})
				).item,
			"Flag resolved.",
			"Failed to resolve flag.",
			() => setIsResolving(false),
		);
	}

	return {
		normalizedTitle,
		setNormalizedTitle,
		normalizedComposer,
		setNormalizedComposer,
		imslpUrl,
		setImslpUrl,
		reviewerNotes,
		setReviewerNotes,
		setCanonicalWorkId,
		catalogSuggestions,
		isSearchingCatalog,
		showCatalogDropdown,
		isFlagging,
		setIsFlagging,
		flagReason,
		setFlagReason,
		flagNotes,
		setFlagNotes,
		isResolving,
		setIsResolving,
		resolutionNotes,
		setResolutionNotes,
		actionPending,
		errorMessage,
		successMessage,
		isClaimedByMe,
		isValidUrl: isValidHttpUrl,
		handleCatalogSearch,
		handleSelectCatalogWork,
		handleClaim,
		handleUnclaim,
		handleNormalizeAndApprove,
		handleConfirmFlag,
		handleConfirmResolve,
	};
}
