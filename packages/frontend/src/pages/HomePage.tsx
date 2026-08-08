import type { FestivalAppController } from "../app/useFestivalAppController.js";

interface HomePageProps {
	app: FestivalAppController;
}

export function HomePage(props: HomePageProps) {
	return (
		<section class="panel hero-panel">
			<h2>Start a new organization</h2>
			<p>Sign-up. Create a Organization. Create a Festival. Invite Users.</p>
			<div class="hero-actions">
				<button
					type="button"
					onClick={() => props.app.openSignInModal("create-org")}
				>
					Sign up or Sign In
				</button>
			</div>
		</section>
	);
}
