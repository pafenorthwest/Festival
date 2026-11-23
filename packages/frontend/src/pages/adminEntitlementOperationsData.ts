import type { AdminEntitlementOperationsResponse } from "@festival/common";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { getAdminEntitlementOperations } from "../lib/api.js";

export function useAdminEntitlementOperations(app: FestivalAppController) {
	const scope = createMemo(() => {
		const route = app.route();
		const user = app.firebaseUser();
		if (
			route.kind !== "org-admin-integrations" ||
			!user ||
			!app.isAdminMember()
		)
			return;
		return { slug: route.slug, user };
	});
	const [data, setData] = createStore<{
		snapshot?: AdminEntitlementOperationsResponse;
	}>({});
	const [loadError, setLoadError] = createSignal("");
	let controller: AbortController | undefined;
	let disposed = false;

	const getSession = () => {
		const current = scope();
		if (!current || disposed) return;
		return {
			slug: current.slug,
			getToken: () => current.user.getIdToken(),
			isCurrent: () => !disposed && scope() === current,
		};
	};

	const loadOperations = async () => {
		controller?.abort();
		const session = getSession();
		if (!session) return;
		const request = new AbortController();
		controller = request;
		const isCurrent = () => !request.signal.aborted && session.isCurrent();
		setLoadError("");
		try {
			const token = await session.getToken();
			if (!isCurrent()) return;
			const response = await getAdminEntitlementOperations(
				token,
				session.slug,
				{
					signal: request.signal,
				},
			);
			if (isCurrent()) setData(reconcile({ snapshot: response }));
		} catch {
			if (isCurrent()) setLoadError("Order operations could not be loaded.");
		}
	};

	createEffect(() => {
		scope();
		setData("snapshot", undefined);
		setLoadError("");
	});

	createEffect(() => {
		const current = scope();
		if (!current) {
			controller?.abort();
			return;
		}
		untrack(() => void loadOperations());
	});

	onCleanup(() => {
		disposed = true;
		controller?.abort();
	});

	return {
		scope,
		snapshot: () => data.snapshot,
		loadError,
		getSession,
		loadOperations,
	};
}

export type AdminEntitlementOperations = ReturnType<
	typeof useAdminEntitlementOperations
>;
