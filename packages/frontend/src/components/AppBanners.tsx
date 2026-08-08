import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";

interface AppBannersProps {
	app: FestivalAppController;
}

export function AppBanners(props: AppBannersProps) {
	return (
		<>
			<Show when={props.app.errorMessage()}>
				<section class="banner error-banner">
					{props.app.errorMessage()}
				</section>
			</Show>
			<Show when={props.app.statusMessage()}>
				<section class="banner status-banner">
					{props.app.statusMessage()}
				</section>
			</Show>
		</>
	);
}
