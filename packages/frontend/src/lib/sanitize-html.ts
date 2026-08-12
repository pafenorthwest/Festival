import DOMPurify from "dompurify";

const SHOPIFY_DESCRIPTION_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"ul",
	"ol",
	"li",
	"a",
] as const;

export function sanitizeShopifyDescriptionHtml(value: string): string {
	return DOMPurify.sanitize(value, {
		ALLOWED_TAGS: [...SHOPIFY_DESCRIPTION_TAGS],
		ALLOWED_ATTR: ["href", "title"],
		ALLOW_ARIA_ATTR: false,
		ALLOW_DATA_ATTR: false,
	});
}
