# Solid Meta (Concise)

Solid Meta manages document metadata (title, description, link tags, social cards) in a component-friendly way for browser apps and SSR contexts.

## Meta commands (quick picks)

### `<Title>` + `<Meta>` (page metadata)
```tsx
<Title>Product Detail</Title>
<Meta name="description" content="Product details and availability" />
<Meta property="og:title" content="Product Detail" />;
```

### `<Link>` + `<Style>` (head assets)
```tsx
<Link rel="canonical" href="https://example.com/products/1" />
<Link rel="preconnect" href="https://cdn.example.com" />
<Style>{":root{--brand:#0f766e}"}</Style>;
```

### `MetaProvider` (root setup)
```tsx
<MetaProvider>
  <App />
</MetaProvider>;
```

## Opinionated: when to use Solid Meta
- Marketing/content pages where SEO and social previews matter.
- SSR/SSG routes that need deterministic per-route head tags.
- Apps with frequent route-level title/description changes.

## Opinionated: when NOT to use Solid Meta
- Internal tools with no crawl/share requirements.
- One-page utility apps where static `<head>` is enough.
- Projects already enforcing head tags externally at platform edge.

## Simplicity guidance
- Keep a baseline title/description in root and override per route only when needed.
- Avoid duplicate canonical/OG tags across nested layouts.
- Prefer explicit route-owned metadata over global mutable helpers.

## Sources
- https://docs.solidjs.com/solid-meta/
- https://docs.solidjs.com/solid-meta/reference/components/title
- https://docs.solidjs.com/solid-meta/reference/components/meta
- https://docs.solidjs.com/solid-meta/reference/components/link
- https://docs.solidjs.com/solid-meta/reference/components/style
- https://docs.solidjs.com/solid-meta/reference/components/meta-provider
