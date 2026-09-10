import type { ApiForExtension } from "@shopify/ui-extensions/checkout";
import { mountReturnButton } from "./return-button.js";

declare const shopify: ApiForExtension<"purchase.thank-you.block.render">;

export default function () {
	mountReturnButton(
		document,
		shopify.settings,
		Boolean(shopify.extension.editor),
	);
}
