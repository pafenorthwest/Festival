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
	const [childrenLoaded, setChildrenLoaded] = createSignal(false);
	const [childrenLoading, setChildrenLoading] = createSignal(false);
	const [teachersLoading, setTeachersLoading] = createSignal(false);
	const [classesLoading, setClassesLoading] = createSignal(false);
	const [childrenError, setChildrenError] = createSignal<string | null>(null);
	const [teachersError, setTeachersError] = createSignal<string | null>(null);
	const [classesError, setClassesError] = createSignal<string | null>(null);
	const [accompanistsError, setAccompanistsError] = createSignal<string | null>(
		null,
	);
	const [optionsRetry, setOptionsRetry] = createSignal(0);
	let childrenRequest = 0;
	let accompanistsRequest = 0;
	onCleanup(() => {
		childrenRequest++;
		accompanistsRequest++;
	});
	async function loadChildren() {
		const request = ++childrenRequest;
		setChildrenLoading(true);
		setChildrenError(null);
		try {
			const res = await getCustomerChildren(input.slug);
			if (request !== childrenRequest) return;
			setChildren(res.children);
			setChildrenLoaded(true);
			if (!input.childId() && res.children.length === 1 && res.children[0])
				input.onAutoSelectChild?.(res.children[0].id);
		} catch {
			if (request === childrenRequest)
				setChildrenError("Performers could not be loaded. Please try again.");
		} finally {
			if (request === childrenRequest) setChildrenLoading(false);
		}
	}
	async function loadAccompanists() {
		const request = ++accompanistsRequest;
		setAccompanistsError(null);
		try {
			const res = await listRegistrationAccompanists(
				input.slug,
				input.festivalSlug,
			);
			if (request === accompanistsRequest) setAccompanists(res.accompanists);
		} catch {
			if (request === accompanistsRequest)
				setAccompanistsError(
					"Accompanists could not be loaded. Please try again.",
				);
		}
	}
	createEffect(() => {
		if (input.isAuthenticated()) {
			void loadChildren();
			void loadAccompanists();
		} else {
			childrenRequest++;
			accompanistsRequest++;
			setChildren([]);
			setChildrenLoaded(false);
			setTeachers([]);
			setEligibleClasses([]);
			setAccompanists([]);
		}
	});
	createEffect(() => {
		const authenticated = input.isAuthenticated();
		optionsRetry();
		const childId = input.childId();
		const divisionId = input.divisionId();
		let cancelled = false;
		onCleanup(() => {
			cancelled = true;
		});
		setTeachers([]);
		setTeachersError(null);
		setTeachersLoading(Boolean(authenticated && childId && divisionId));
		if (!authenticated || !childId || !divisionId) return;
		void listRegistrationTeachers(
			input.slug,
			input.festivalSlug,
			childId,
			divisionId,
		)
			.then((res) => {
				if (!cancelled) setTeachers(res.teachers);
			})
			.catch(() => {
				if (!cancelled)
					setTeachersError("Teachers could not be loaded. Please try again.");
			})
			.finally(() => {
				if (!cancelled) setTeachersLoading(false);
			});
	});
	createEffect(() => {
		const authenticated = input.isAuthenticated();
		optionsRetry();
		const childId = input.childId();
		const divisionId = input.divisionId();
		const teacherId = input.teacherId();
		let cancelled = false;
		onCleanup(() => {
			cancelled = true;
		});
		setEligibleClasses([]);
		setClassesError(null);
		setClassesLoading(
			Boolean(authenticated && childId && divisionId && teacherId),
		);
		if (!authenticated || !childId || !divisionId || !teacherId) return;
		void listRegistrationEligibleClasses(
			input.slug,
			input.festivalSlug,
			childId,
			divisionId,
			teacherId,
		)
			.then((res) => {
				if (!cancelled) setEligibleClasses(res.classes);
			})
			.catch(() => {
				if (!cancelled)
					setClassesError("Classes could not be loaded. Please try again.");
			})
			.finally(() => {
				if (!cancelled) setClassesLoading(false);
			});
	});
	return {
		children,
		teachers,
		eligibleClasses,
		accompanists,
		loadChildren,
		loadAccompanists,
		childrenLoaded,
		childrenLoading,
		teachersLoading,
		classesLoading,
		childrenError,
		teachersError,
		classesError,
		accompanistsError,
		retryOptions: () => setOptionsRetry((count) => count + 1),
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
