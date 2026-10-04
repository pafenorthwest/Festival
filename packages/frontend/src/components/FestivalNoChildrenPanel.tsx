import { Button } from "./Button.js";

export function FestivalNoChildrenPanel(props: {
	onManageChildren: () => void;
}) {
	return (
		<div class="panel flow-panel" role="alert">
			<p>No children found in your family account. Please add a child first.</p>
			<Button type="button" onClick={props.onManageChildren}>
				Manage Children
			</Button>
		</div>
	);
}
