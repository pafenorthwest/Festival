import type {
	CanonicalWork,
	CustomerWaitlistEntryDto,
	RegistrationEligibleClass,
} from "@festival/common";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import {
	type CustomerChildDto,
	getCustomerChildren,
	getCustomerProfile,
	listFestivalWaitlistEntries,
	listRegistrationAccompanists,
	listRegistrationEligibleClasses,
	listRegistrationTeachers,
	searchRegistrationConcertoCatalog,
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

export function useConcertoCatalogSearch(
	slug: Accessor<string>,
	festivalSlug: Accessor<string>,
	enabled: Accessor<boolean>,
) {
	const [query, setQuery] = createSignal("");
	const [catalogWorks, setCatalogWorks] = createSignal<CanonicalWork[]>([]);
	const [results, setResults] = createSignal<CanonicalWork[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string>();
	const [retryCount, setRetryCount] = createSignal(0);

	createEffect(() => {
		slug();
		setCatalogWorks([]);
	});

	createEffect(() => {
		const organizationSlug = slug();
		const festival = festivalSlug();
		const search = query().trim();
		retryCount();
		if (!enabled()) return;
		let cancelled = false;
		setLoading(true);
		setError(undefined);
		setResults([]);
		const timer = setTimeout(() => {
			void searchRegistrationConcertoCatalog(organizationSlug, festival, search)
				.then(({ works }) => {
					if (cancelled) return;
					setResults(works);
					setCatalogWorks((known) => [
						...new Map(
							[...known, ...works].map((work) => [work.id, work]),
						).values(),
					]);
				})
				.catch(() => {
					if (!cancelled) setError("Could not search the concerto catalog.");
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		}, 250);
		onCleanup(() => {
			cancelled = true;
			clearTimeout(timer);
		});
	});

	return {
		catalogWorks,
		results,
		query,
		setQuery,
		loading,
		error,
		retry: () => setRetryCount((count) => count + 1),
	};
}
