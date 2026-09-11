import { onMount } from "solid-js";
import { buildOrgCustomerAccountMembershipsPath } from "../lib/routes.js";

export function LegacyCustomerAccountRedirect(props: { slug: string }) {
	onMount(() => {
		window.location.replace(
			`${buildOrgCustomerAccountMembershipsPath(props.slug)}${window.location.search}${window.location.hash}`,
		);
	});

	return null;
}
