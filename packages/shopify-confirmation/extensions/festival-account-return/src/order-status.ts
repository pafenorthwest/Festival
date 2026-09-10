import type { ApiForExtension } from "@shopify/ui-extensions/customer-account";
import { mountReturnButton } from "./return-button.js";

declare const shopify: ApiForExtension<"customer-account.order-status.block.render">;

export default function () {
	mountReturnButton(
		document,
		shopify.settings,
		Boolean(shopify.extension.editor),
	);
}
