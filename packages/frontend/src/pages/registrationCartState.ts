import type {
	ClassCheckoutLineItemInput,
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
	priceCents: number;
	accompanistId?: string | null;
	accompanistName?: string | null;
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
}

export function resetClassFormSelection(target: ClassFormResetTarget): void {
	target.setSelectedClassId("");
	target.setPieces([]);
	target.setSelectedAccompanistId("");
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
		price: string;
	},
	accompanist: { id: string; name: string } | null,
	pieces: RepertoirePiece[],
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
		priceCents: parsePriceToCents(cls.price),
		accompanistId: accompanist?.id || null,
		accompanistName: accompanist?.name ?? null,
		pieces: [...pieces],
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
		pieces: item.pieces.map((piece) => ({
			title: piece.title,
			composer: piece.composer,
			movement: piece.movement?.trim() || null,
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
}

export function createRegistrationCart(
	initialItems: RegistrationCartItem[] = [],
): RegistrationCartState {
	const [items, setItems] = createSignal<RegistrationCartItem[]>(initialItems);

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
		setItems((prev) => prev.filter((item) => item.lineId !== lineId));
	}

	function removeItems(lineIds: string[]): void {
		if (lineIds.length === 0) return;
		const idSet = new Set(lineIds);
		setItems((prev) => prev.filter((item) => !idSet.has(item.lineId)));
	}

	function clearCart(): void {
		setItems([]);
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
	};
}
