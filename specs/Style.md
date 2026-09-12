# Festival UI style

`packages/frontend/src/styles.css` is the implementation and source of truth for this visual system. This document records that system for use when adding or revising UI. It does not use Skeleton, and no `data-theme` attribute is required.

## Foundation

The interface is editorial and warm: a serif typeface, dark blue-black ink, a cream-paper background, softly translucent white panels, restrained shadows, and muted gold, green, and terracotta status colors. Prefer the existing `--bullet-*` tokens to new raw colors.

```css
:root {
	--bullet-ink: #1f2431;
	--bullet-soft-ink: rgba(31, 36, 49, 0.7);
	--bullet-paper: #f7f4ee;
	--bullet-panel: rgba(255, 255, 255, 0.82);
	--bullet-panel-border: rgba(31, 36, 49, 0.12);
	--bullet-accent: #303240;
	--bullet-accent-strong: #2a2c40;
	--bullet-gold: #b6872c;
	--bullet-error: #b94d36;
	--bullet-success: #1f7a57;
	--bullet-shadow: 0 24px 60px rgba(31, 36, 49, 0.12);
	--bullet-radius: 18px;
	--bullet-serif: "Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif;
}
```

- Use `--bullet-ink` for primary text and `--bullet-soft-ink` for supporting text.
- The page background is a cream vertical gradient (`#fdfaf3` to `#efe8da`) with subtle blue and gold radial highlights; do not replace it with a flat white or dark surface.
- Use the serif stack for all interface text. Use UI monospace only for technical values such as Shopify identifiers.
- All elements use `box-sizing: border-box`.
- Links are `--bullet-accent-strong`; preserve the browser-default underline unless a component explicitly removes it.
- Inline `code` is slightly smaller, with a pale blue background and a 6px radius.

## Layout and type

- The main `.shell` is centered, `1100px` wide at most, and has `2.5rem 1.25rem 4rem` padding.
- Primary layouts use CSS grid with `1rem`–`1.5rem` gaps. Use flex only for inline control groups and headers.
- The masthead and organization heading use large serif headlines (`clamp(2.4rem, 4–5vw, 4.5rem)`) with tight leading. The membership heading is `2rem`; smaller section headings generally retain their browser/default scale unless a component rule specifies otherwise.
- Use `.eyebrow` for metadata above a title: uppercase, `0.76rem`, `0.18em` tracking, and `--bullet-accent-strong`.
- Use `.lede`, `.muted`, `.identity-email`, and other secondary copy in `--bullet-soft-ink`.

## Surfaces and corners

The UI deliberately mixes compact utility corners with softer prominent surfaces; do not normalize every element to one radius.

| Surface | Treatment |
| --- | --- |
| Panel, banner, identity card | Translucent white panel, `1px` panel border, `backdrop-filter: blur(18px)`, shared shadow, 18px radius |
| Forms, navigation, ordinary rows | White/translucent surface with subtle border; normally 12px radius |
| Product cards, alerts, compact result cards | 8px radius |
| Buttons and compact header controls | 4px radius when carrying the `.button` class |
| Status badges, dots, spinners, icon-only controls | Fully pill/round (`999px`) |
| Modal card | 22px radius |

Use `.panel` for a general padded surface (`1.4rem` padding), `.hero-panel` for a large introductory panel with a faint blue-and-gold overlay, and `.banner` for a padded message surface. Success and error banners use white text on green and terracotta gradients respectively.

## Controls

- Native buttons default to a dark `--bullet-accent` to `--bullet-accent-strong` diagonal gradient, white text, a generous `0.9rem 1.25rem` padding, a soft blue shadow, and a pill radius.
- App buttons rendered through `Button` receive the `.button` class and therefore use a 4px radius. This is the standard for product and workflow actions.
- `.secondary-button` is transparent with ink text, a subtle border, and no shadow. `compact-header-button` adds compact padding and a dark ink fill with white text.
- Disabled buttons are gray (`#9ca3af`), retain light text, remove the shadow, and show `not-allowed` cursor behavior.
- Inputs and selects span their container, have 12px corners, a subtle ink border, and an almost-opaque white fill. Invalid inputs use the terracotta error border and focus ring; read-only inputs use muted text on a cool gray fill.
- Forms use `.field` with a `0.4rem` gap. Keep field errors in `--bullet-error`.
- Use `.icon-button` only for compact destructive icon actions: transparent, round, terracotta icon/text, and a light terracotta border.

## Semantic color

| Meaning | Primary treatment |
| --- | --- |
| Success / active | `--bullet-success` (`#1f7a57`); pale green backgrounds for rows and diagnostics |
| Error / rejected | `--bullet-error` (`#b94d36`); pale terracotta backgrounds or white-on-terracotta banner |
| Warning / needs review | `--bullet-gold` (`#b6872c`); pale gold background; dark gold `#735710` for white-text badges |
| Processing / informational | `--bullet-accent` with pale blue background |
| Neutral / unavailable | `#6b7280` |

Membership cards express state with a 5px colored left border and a matching pill badge. Status dots and division badges follow the same mapping. Do not use a color alone where a textual status is already available.

## Badges

A badge is a compact notice that communicates a state. Base a badge on `.division-status`: `0.3rem 0.55rem` padding, a `999px` pill radius, white text, and an `0.82rem` bold type size. Use a semantic modifier to set its background and text color for its state.

```css
.badge {
	padding: 0.3rem 0.55rem;
	border-radius: 999px;
	font-size: 0.82rem;
	font-weight: 700;
}

.badge-active { background: var(--bullet-success); color: white; }
.badge-inactive { background: #6b7280; color: white; }
.badge-processing { background: var(--bullet-accent); color: white; }
.badge-review { background: #735710; color: white; }
.badge-rejected { background: var(--bullet-error); color: white; }
```

Use the state label as the badge text (for example, “Active”, “Processing”, or “Needs review”). Keep badges reserved for concise state notices, not for navigation, primary actions, or arbitrary categorization.

## Listing tables

A listing table presents comparable records in columns. It is a layout pattern, not a native HTML table: build it with `div` and `span` elements (and semantic interactive controls where needed), never with the `<table>` element.

- Embed the listing in a container with padding, a subtle rounded border, and the same translucent or transparent surface as the panel that contains it.
- Use a grid for the header and every row. Give the header and rows matching column definitions so values remain aligned.
- Separate data rows with a bottom divider inset slightly from each side. Do not draw vertical column separators in data rows; distinguish columns with grid gaps and aligned content.
- Give the header a soft contrasting fill, tight top and bottom borders, and heavier, optionally darker text for scanning. Header column separators are permitted; inset them slightly from the top and bottom of the header.
- On hover, a data row receives only a faint shadow. Its fill, border, spacing, and content must remain stable so the hover state does not shift the layout.
- A badge column may contain one or more badges. Keep that column compact and allow badges to wrap when space is constrained.
- Prefer icon-only controls for row actions, using an accessible name. Use a text button only when the action cannot be communicated clearly by an icon.

```html
<div class="listing-table" role="table">
  <div class="listing-table-header" role="row">
    <span role="columnheader">Name</span>
    <span role="columnheader">Status</span>
    <span role="columnheader" aria-label="Actions"></span>
  </div>
  <div class="listing-table-row" role="row">
    <span role="cell">Spring Festival</span>
    <span class="listing-table-badges" role="cell">
      <span class="badge badge-active">Active</span>
    </span>
    <span class="listing-table-actions" role="cell">
      <button class="icon-button" type="button" aria-label="Edit Spring Festival">…</button>
    </span>
  </div>
</div>
```

Keep the table background transparent or visually continuous with its enclosing container. Do not introduce alternating row colors, boxed cells, or full-height grid lines; the header and understated row dividers provide the necessary structure.

## Major components

- **Organization landing:** Present festival items as unbordered translucent rows with 12px corners. Audience links are bold, large role banners with an 18px radius and shadow: teachers blue (`#4459d6`), parents terracotta, volunteers green, accompanists gold.
- **Navigation:** The organization side navigation is a sticky, translucent 13.5rem panel. Compact navigation links use 6px corners; its collapsed state is 4.25rem wide and hides labels and section headings.
- **Membership purchasing:** Use responsive product cards (`minmax(240px, 1fr)`), 8px corners, and 1.2rem padding. Checkout content is centered and no wider than 640px, with horizontal dividers between summary, steps, and actions.
- **Customer memberships:** Use 12px translucent cards, a 5px semantic left border, grid-based details, and a pill badge. Section headers and card headers stack on small screens.
- **Administration:** Use white/translucent 12px workflow cards and rows with minimal shadows. Prefer `grid` for list rows, settings values, and two-column admin layouts. Use green and gold fills to distinguish accepted/active from pending state.
- **Modal:** Overlay the page with `rgba(31, 36, 49, 0.42)` and center a blurred, 22px card. Authentication action stacks are full width.

## Responsive behavior

- At `760px` and below, membership administration layouts and controls become a single column; metadata aligns left; prerequisites stack vertically.
- At `720px` and below, mastheads, administration card grids, user/festival rows, and settings values become single column. Organization headers and welcome boxes stack vertically. Full-width secondary actions are used where their header stacks.
- Preserve the side navigation and shell structure; narrow layouts reduce gaps rather than removing page hierarchy.

## Implementation rules

- Add styles to `packages/frontend/src/styles.css`; reuse an existing component class and token when it fits.
- Do not introduce Skeleton theme tokens, a `data-theme` dependency, a sans-serif replacement, generic utility-framework colors, or a new global radius scale.
- Keep decoration restrained: translucent panels, fine borders, sparse shadows, and the existing blue/gold highlights are the visual signature.
- Match component-specific radii and fills instead of relying on the global native-button default.
