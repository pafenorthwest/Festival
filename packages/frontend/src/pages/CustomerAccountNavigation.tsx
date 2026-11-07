import { Button } from "../components/Button.js";
import {
	buildOrgCustomerAccountAvailabilityPath,
	buildOrgCustomerAccountChildrenPath,
	buildOrgCustomerAccountClassesPath,
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
				data-preload-path={buildOrgCustomerAccountChildrenPath(props.slug)}
				onClick={() =>
					navigate(buildOrgCustomerAccountChildrenPath(props.slug))
				}
			>
				Children
			</Button>
			<Button
				type="button"
				variant="compact-header"
				data-preload-path={buildOrgCustomerAccountMembershipsPath(props.slug)}
				onClick={() =>
					navigate(buildOrgCustomerAccountMembershipsPath(props.slug))
				}
			>
				Memberships
			</Button>
			<Button
				type="button"
				variant="compact-header"
				data-preload-path={buildOrgCustomerAccountContactPath(props.slug)}
				onClick={() => navigate(buildOrgCustomerAccountContactPath(props.slug))}
			>
				Contact Information
			</Button>
			<Button
				type="button"
				variant="compact-header"
				data-preload-path={buildOrgCustomerAccountOrdersPath(props.slug)}
				onClick={() => navigate(buildOrgCustomerAccountOrdersPath(props.slug))}
			>
				Order History
			</Button>
			<Button
				type="button"
				variant="compact-header"
				data-preload-path={buildOrgCustomerAccountClassesPath(props.slug)}
				onClick={() => navigate(buildOrgCustomerAccountClassesPath(props.slug))}
			>
				Classes
			</Button>
			<Button
				type="button"
				variant="compact-header"
				data-preload-path={buildOrgCustomerAccountAvailabilityPath(props.slug)}
				onClick={() =>
					navigate(buildOrgCustomerAccountAvailabilityPath(props.slug))
				}
			>
				Availability
			</Button>
		</nav>
	);
}
