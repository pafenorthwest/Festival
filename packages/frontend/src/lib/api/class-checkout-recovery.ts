import type {
	AdminClassCheckoutRecoveryAction,
	AdminClassCheckoutRecoveryDto,
	AdminClassCheckoutRecoveryListResponse,
	AdminClassCheckoutRecoverySweepResponse,
	AdminResolveClassCheckoutRecoveryInput,
	AdminResolveClassCheckoutRecoveryResponse,
} from "@festival/common";
import { hc } from "hono/client";
import type { CommerceRoutesType } from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	resolveAuthToken,
	rpcCall,
} from "./client.js";

export type {
	AdminClassCheckoutRecoveryAction,
	AdminClassCheckoutRecoveryDto,
	AdminClassCheckoutRecoveryListResponse,
	AdminClassCheckoutRecoverySweepResponse,
	AdminResolveClassCheckoutRecoveryInput,
	AdminResolveClassCheckoutRecoveryResponse,
};

const enc = encodeURIComponent;

/** Writes need the operator CSRF header, which the backend pairs with an origin check. */
async function classRecoveries(options: { idToken?: string; write?: boolean }) {
	const idToken = await resolveAuthToken(options.idToken);
	return hc<CommerceRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({
			idToken,
			...(options.write
				? { extraHeaders: { "X-CSRF-Token": "admin-csrf" } }
				: {}),
		}),
	}).organizations[":slug"].admin["class-checkout-recoveries"];
}

export async function listAdminClassCheckoutRecoveries(
	slug: string,
	options?: { customerId?: string; idToken?: string },
): Promise<AdminClassCheckoutRecoveryListResponse> {
	const ep = await classRecoveries({ idToken: options?.idToken });
	const args = {
		param: { slug: enc(slug) },
		query: options?.customerId ? { customerId: options.customerId } : {},
	};
	return rpcCall<AdminClassCheckoutRecoveryListResponse>(
		ep.$get(args),
		ep.$path(args),
	);
}

/** Moves expired in-flight attempts into recovery so an operator can resolve them. */
export async function sweepAdminClassCheckoutRecoveries(
	slug: string,
	idToken?: string,
): Promise<AdminClassCheckoutRecoverySweepResponse> {
	const ep = (await classRecoveries({ idToken, write: true })).reap;
	const args = { param: { slug: enc(slug) } };
	return rpcCall<AdminClassCheckoutRecoverySweepResponse>(
		ep.$post(args),
		ep.$path(args),
	);
}

export async function resolveAdminClassCheckoutRecovery(
	slug: string,
	recoveryReference: string,
	input: AdminResolveClassCheckoutRecoveryInput,
	idToken?: string,
): Promise<AdminResolveClassCheckoutRecoveryResponse> {
	const ep = (await classRecoveries({ idToken, write: true }))[
		":recoveryReference"
	].resolve;
	const args = {
		param: { slug: enc(slug), recoveryReference: enc(recoveryReference) },
		json: input,
	};
	return rpcCall<AdminResolveClassCheckoutRecoveryResponse>(
		ep.$post(args),
		ep.$path({ param: args.param }),
	);
}
