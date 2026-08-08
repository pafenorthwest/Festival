interface AccessDeniedPanelProps {
	message: string;
}

export function AccessDeniedPanel(props: AccessDeniedPanelProps) {
	return (
		<section class="panel flow-panel access-denied-panel">
			<h2>Access denied</h2>
			<p>{props.message}</p>
		</section>
	);
}
