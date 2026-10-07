import type { RegistrationEligibleClass } from "@festival/common";
import { type Accessor, createEffect, createSignal } from "solid-js";
import {
	type CustomerChildDto,
	getCustomerChildren,
	listRegistrationAccompanists,
	listRegistrationEligibleClasses,
	listRegistrationTeachers,
} from "../lib/api.js";

export interface RegistrationOptionsInput {
	slug: string;
	festivalSlug: string;
	isAuthenticated: Accessor<boolean>;
	childId: Accessor<string>;
	divisionId: Accessor<string>;
	teacherId: Accessor<string>;
	onAutoSelectChild?: (childId: string) => void;
}

export function useRegistrationOptions(input: RegistrationOptionsInput) {
	const [children, setChildren] = createSignal<CustomerChildDto[]>([]);
	const [teachers, setTeachers] = createSignal<
		Array<{ id: string; name: string }>
	>([]);
	const [eligibleClasses, setEligibleClasses] = createSignal<
		RegistrationEligibleClass[]
	>([]);
	const [accompanists, setAccompanists] = createSignal<
		Array<{ id: string; name: string }>
	>([]);

	async function loadChildren() {
		try {
			const res = await getCustomerChildren(input.slug);
			setChildren(res.children);
			if (res.children.length === 1 && res.children[0]) {
				input.onAutoSelectChild?.(res.children[0].id);
			}
		} catch {
			// Handled gracefully in UI
		}
	}

	async function loadAccompanists() {
		try {
			const res = await listRegistrationAccompanists(
				input.slug,
				input.festivalSlug,
			);
			setAccompanists(res.accompanists);
		} catch {
			// Handled gracefully in UI
		}
	}

	createEffect(() => {
		if (input.isAuthenticated()) {
			void loadChildren();
			void loadAccompanists();
		}
	});

	createEffect(async () => {
		const cid = input.childId();
		const did = input.divisionId();
		if (!cid || !did) {
			setTeachers([]);
			return;
		}
		try {
			const res = await listRegistrationTeachers(
				input.slug,
				input.festivalSlug,
				cid,
				did,
			);
			setTeachers(res.teachers);
		} catch {
			setTeachers([]);
		}
	});

	createEffect(async () => {
		const cid = input.childId();
		const did = input.divisionId();
		const tid = input.teacherId();
		if (!cid || !did || !tid) {
			setEligibleClasses([]);
			return;
		}
		try {
			const res = await listRegistrationEligibleClasses(
				input.slug,
				input.festivalSlug,
				cid,
				did,
				tid,
			);
			setEligibleClasses(res.classes);
		} catch {
			setEligibleClasses([]);
		}
	});

	return {
		children,
		teachers,
		eligibleClasses,
		accompanists,
		loadChildren,
	};
}
