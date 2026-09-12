interface FestivalLandingPageProps {
	slug: string;
}

export function FestivalLandingPage(props: FestivalLandingPageProps) {
	const membershipPath = `/org/${props.slug}/membership`;

	return (
		<section class="org-landing">
			<h2>Register</h2>
			<nav class="role-banners" aria-label="Audience links">
				<a class="role-banner teachers" href={membershipPath}>
					Teachers
				</a>
				<a class="role-banner parents" href="/classes">
					Parents
				</a>
				<a class="role-banner volunteers" href="/sign-up">
					Volunteers
				</a>
				<a
					class="role-banner accompanists"
					href={`/org/${props.slug}/accompanist-membership`}
				>
					Accompanists
				</a>
			</nav>
			<a
				class="button secondary-button compact-header-button all-memberships-link"
				href={membershipPath}
			>
				All Memberships
			</a>
		</section>
	);
}
