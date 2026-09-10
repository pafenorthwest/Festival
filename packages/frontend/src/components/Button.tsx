import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "compact-header";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
}

export function Button(props: ButtonProps) {
	const [local, buttonProps] = splitProps(props, ["variant", "class", "children"]);
	const classes = () => {
		const variantClasses =
			local.variant === "secondary"
				? "secondary-button"
				: local.variant === "compact-header"
					? "secondary-button compact-header-button"
					: "";

		return ["button", variantClasses, local.class].filter(Boolean).join(" ");
	};

	return (
		<button {...buttonProps} class={classes()}>
			{local.children}
		</button>
	);
}
