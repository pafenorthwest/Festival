import type {
	ClassCheckoutLineItemInput,
	ClassCheckoutRecoveryStatusDto,
	RepertoirePiece,
} from "@festival/common";
import { createSignal } from "solid-js";

export interface RegistrationCartItem {
	lineId: string;
	childId: string;
	childName: string;
	divisionId: string;
	divisionName: string;
	teacherId: string;
	teacherName: string;
	classId: string;
	className: string;
	classSubtypeId?: string | null;
	classSubtypeName?: string | null;
	minimumAge?: number;
	maximumAge?: number;
	priceCents: number;
	accompanistId?: string | null;
	accompanistName?: string | null;
	instrumentId?: string;
	instrumentName?: string;
	pieces: RepertoirePiece[];
}

export type AddRegistrationCartItemInput = Omit<
	RegistrationCartItem,
	"lineId"
> & {
	lineId?: string;
};

export function formatPriceCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

export function parsePriceToCents(price: string | number): number {
	if (typeof price === "number") return Math.round(price * 100);
	const parsed = Number.parseFloat(price);
	return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export interface ClassFormResetTarget {
	setSelectedClassId: (id: string) => void;
	setPieces: (pieces: RepertoirePiece[]) => void;
	setSelectedAccompanistId: (id: string) => void;
	setSelectedInstrumentId?: (id: string) => void;
}

export function resetClassFormSelection(target: ClassFormResetTarget): void {
	target.setSelectedClassId("");
	target.setPieces([]);
	target.setSelectedAccompanistId("");
	target.setSelectedInstrumentId?.("");
}

export function buildCartItemInput(
	child: { id: string; displayName: string },
	divisionId: string,
	divisionName: string,
	teacher: { id: string; name: string } | null,
	cls: {
		id: string;
		displayName: string;
		classSubtypeId?: string | null;
		minimumAge?: number;
		maximumAge?: number;
		price: string;
	},
	accompanist: { id: string; name: string } | null,
	pieces: RepertoirePiece[],
	instrument?: { id: string; displayName: string } | null,
): AddRegistrationCartItemInput {
	return {
		childId: child.id,
		childName: child.displayName,
		divisionId,
		divisionName,
		teacherId: teacher?.id ?? "",
		teacherName: teacher?.name ?? "Teacher",
		classId: cls.id,
		className: cls.displayName,
		classSubtypeId: cls.classSubtypeId ?? null,
		minimumAge: cls.minimumAge,
		maximumAge: cls.maximumAge,
		priceCents: parsePriceToCents(cls.price),
		accompanistId: accompanist?.id || null,
		accompanistName: accompanist?.name ?? null,
		pieces: [...pieces],
		...(instrument
			? { instrumentId: instrument.id, instrumentName: instrument.displayName }
			: {}),
	};
}

export function cartItemsToLineItemInputs(
	items: RegistrationCartItem[],
): (ClassCheckoutLineItemInput & { classId: string })[] {
	return items.map((item) => ({
		childId: item.childId,
		classId: item.classId,
		festivalClassId: item.classId,
		teacherId: item.teacherId,
		accompanistId: item.accompanistId || null,
		...(item.instrumentId ? { instrumentId: item.instrumentId } : {}),
		pieces: item.pieces.map((piece) => ({
			title: piece.title,
			composer: piece.composer,
			movement: piece.movement?.trim() || null,
			...(piece.catalogWorkId ? { catalogWorkId: piece.catalogWorkId } : {}),
			durationMinutes: Math.floor((piece.durationSeconds || 0) / 60),
			durationSeconds: Math.max(1, piece.durationSeconds || 0),
		})),
	}));
}

export interface RegistrationCartState {
	items: () => RegistrationCartItem[];
	itemCount: () => number;
	totalCents: () => number;
	totalPriceFormatted: () => string;
	hasItem: (childId: string, classId: string) => boolean;
	addItem: (input: AddRegistrationCartItemInput) => RegistrationCartItem;
	removeItem: (lineId: string) => void;
	removeItems: (lineIds: string[]) => void;
	clearCart: () => void;
	getCheckoutIdempotencyKey: () => string;
	checkoutSubmission: () => RegistrationCheckoutSubmission | null;
	beginCheckout: () => RegistrationCheckoutSubmission;
	releaseCheckout: () => void;
	restartAbandonedCheckout: () => boolean;
	completeCheckout: (submission: RegistrationCheckoutSubmission) => void;
	checkoutRecovery: () => ClassCheckoutRecoveryStatusDto | null;
	setCheckoutRecovery: (recovery: ClassCheckoutRecoveryStatusDto) => void;
}

export interface RegistrationCheckoutSubmission {
	idempotencyKey: string;
	lineItems: ReturnType<typeof cartItemsToLineItemInputs>;
	lineIds: string[];
}

export function createRegistrationCart(
	initialItems: RegistrationCartItem[] = [],
): RegistrationCartState {
	const [items, setItems] = createSignal<RegistrationCartItem[]>(initialItems);
	let checkoutPayload = "";
	let checkoutKey = "";
	const [checkoutSubmission, setCheckoutSubmission] =
		createSignal<RegistrationCheckoutSubmission | null>(null);
	const [checkoutRecovery, setCheckoutRecovery] =
		createSignal<ClassCheckoutRecoveryStatusDto | null>(null);
	function beginCheckout() {
		const current = checkoutSubmission();
		if (current) return current;
		const submission = {
			idempotencyKey: getCheckoutIdempotencyKey(),
			lineItems: structuredClone(cartItemsToLineItemInputs(items())),
			lineIds: items().map((item) => item.lineId),
		};
		setCheckoutSubmission(submission);
		return submission;
	}
	function releaseCheckout() {
		setCheckoutSubmission(null);
		setCheckoutRecovery(null);
	}
	function restartAbandonedCheckout() {
		const recovery = checkoutRecovery();
		if (
			recovery?.status !== "resolved" ||
			!["abandoned_unknown", "checkout_abandoned"].includes(recovery.reasonCode)
		)
			return false;
		releaseCheckout();
		checkoutPayload = "";
		checkoutKey = "";
		return true;
	}
	function completeCheckout(submission: RegistrationCheckoutSubmission) {
		const submitted = new Set(submission.lineIds);
		setItems((current) =>
			current.filter((item) => !submitted.has(item.lineId)),
		);
		if (checkoutSubmission() === submission) releaseCheckout();
		checkoutPayload = "";
		checkoutKey = "";
	}
	function assertEditable() {
		if (checkoutSubmission())
			throw new Error(
				"Check the existing checkout before changing these registrations.",
			);
	}
	function getCheckoutIdempotencyKey() {
		const submission = checkoutSubmission();
		if (submission) return submission.idempotencyKey;
		const payload = JSON.stringify(cartItemsToLineItemInputs(items()));
		if (payload !== checkoutPayload || !checkoutKey) {
			checkoutPayload = payload;
			checkoutKey = crypto.randomUUID();
		}
		return checkoutKey;
	}

	const itemCount = () => items().length;

	const totalCents = () =>
		items().reduce((sum, item) => sum + item.priceCents, 0);

	const totalPriceFormatted = () => formatPriceCents(totalCents());

	function hasItem(childId: string, classId: string): boolean {
		if (!childId || !classId) return false;
		return items().some(
			(item) => item.childId === childId && item.classId === classId,
		);
	}

	function addItem(input: AddRegistrationCartItemInput): RegistrationCartItem {
		assertEditable();
		if (hasItem(input.childId, input.classId)) {
			throw new Error(
				`Class "${input.className}" is already in the cart for ${input.childName}.`,
			);
		}
		const lineId =
			input.lineId ||
			(typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `line_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

		const newItem: RegistrationCartItem = {
			...input,
			lineId,
		};
		setItems((prev) => [...prev, newItem]);
		return newItem;
	}

	function removeItem(lineId: string): void {
		assertEditable();
		setItems((prev) => prev.filter((item) => item.lineId !== lineId));
	}

	function removeItems(lineIds: string[]): void {
		assertEditable();
		if (lineIds.length === 0) return;
		const idSet = new Set(lineIds);
		setItems((prev) => prev.filter((item) => !idSet.has(item.lineId)));
	}

	function clearCart(): void {
		setItems([]);
		releaseCheckout();
		checkoutPayload = "";
		checkoutKey = "";
	}

	return {
		items,
		itemCount,
		totalCents,
		totalPriceFormatted,
		hasItem,
		addItem,
		removeItem,
		removeItems,
		clearCart,
		getCheckoutIdempotencyKey,
		checkoutSubmission,
		beginCheckout,
		releaseCheckout,
		restartAbandonedCheckout,
		completeCheckout,
		checkoutRecovery,
		setCheckoutRecovery,
	};
}
