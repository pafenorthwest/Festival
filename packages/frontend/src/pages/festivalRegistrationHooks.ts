import type {
	CustomerWaitlistEntryDto,
	RegistrationEligibleClass,
} from "@festival/common";
import { type Accessor, createEffect, createSignal } from "solid-js";
import {
	type CustomerChildDto,
	getCustomerChildren,
	getCustomerProfile,
	listFestivalWaitlistEntries,
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

export interface RegistrationWaitlistInput {
	slug: string;
	festivalSlug: string;
	isAuthenticated: Accessor<boolean>;
	selectedClassId: Accessor<string>;
	selectedChildId: Accessor<string>;
}

export function useRegistrationWaitlist(input: RegistrationWaitlistInput) {
	const [sessionProfile, setSessionProfile] = createSignal<{
		name?: string;
		email?: string;
		phone?: string;
	} | null>(null);
	const [waitlistEntries, setWaitlistEntries] = createSignal<
		CustomerWaitlistEntryDto[]
	>([]);

	const currentWaitlistEntry = () => {
		const classId = input.selectedClassId();
		const childId = input.selectedChildId();
		if (!classId || !childId) return null;
		return (
			waitlistEntries().find(
				(e) =>
					e.festivalClassId === classId &&
					e.childId === childId &&
					e.status !== "withdrawn",
			) ?? null
		);
	};

	const handleWaitlistEntryChanged = async () => {
		try {
			const res = await listFestivalWaitlistEntries(
				input.slug,
				input.festivalSlug,
			);
			setWaitlistEntries(res.entries ?? []);
		} catch {}
	};

	createEffect(() => {
		if (input.isAuthenticated()) {
			setSessionProfile((prev) => prev ?? { name: "", email: "", phone: "" });
			void getCustomerProfile(input.slug)
				.then((res) => {
					if (res?.profile) {
						setSessionProfile({
							name: res.profile.name ?? "",
							email: res.profile.email ?? "",
							phone: res.profile.phone ?? "",
						});
					}
				})
				.catch(() => {});
			void handleWaitlistEntryChanged();
		} else {
			setSessionProfile(null);
			setWaitlistEntries([]);
		}
	});

	return {
		sessionProfile,
		currentWaitlistEntry,
		handleWaitlistEntryChanged,
	};
}
