import { Button } from "../components/Button.js";
import {
	buildOrgCustomerAccountChildrenPath,
	buildOrgCustomerAccountContactPath,
	buildOrgCustomerAccountMembershipsPath,
	buildOrgCustomerAccountOrdersPath,
} from "../lib/routes.js";

export function CustomerAccountNavigation(props: { slug: string }) {
	function navigate(path: string) {
		window.location.assign(path);
	}

	return (
		<nav class="customer-account-navigation" aria-label="Customer account">
			<Button
				type="button"
				variant="compact-header"
				onClick={() =>
					navigate(buildOrgCustomerAccountChildrenPath(props.slug))
				}
			>
				Children
			</Button>
			<Button
				type="button"
				variant="compact-header"
				onClick={() =>
					navigate(buildOrgCustomerAccountMembershipsPath(props.slug))
				}
			>
				Memberships
			</Button>
			<Button
				type="button"
				variant="compact-header"
				onClick={() => navigate(buildOrgCustomerAccountContactPath(props.slug))}
			>
				Contact Information
			</Button>
			<Button
				type="button"
				variant="compact-header"
				onClick={() => navigate(buildOrgCustomerAccountOrdersPath(props.slug))}
			>
				Order History
			</Button>
		</nav>
	);
}
