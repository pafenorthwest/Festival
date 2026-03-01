# SolidStart (Concise)

SolidStart is Solid’s full-stack app framework. Use it when routing + server capabilities + rendering strategy decisions need to be one coherent system.

## SolidStart commands (quick picks)

### `defineConfig` (project setup)
```ts
import { defineConfig } from "@solidjs/start/config";
export default defineConfig({
  server: { preset: "node-server" }
});
```

### File-based route component
```tsx
export default function Home() {
  return <main><h1>SolidStart</h1></main>;
}
```

### Server function (`"use server"`)
```tsx
const createOrder = action(async (form: FormData) => {
  "use server";
  return await saveOrder(form);
}, "create-order");
```

### Route preload/data utility
```tsx
export const route = { preload: () => getProductList() };
export default function Products() {
  return <ProductGrid />;
}
```

## Opinionated: when to use SolidStart
- You need SSR/SSG/hybrid rendering decisions in the same app.
- You need server functions and frontend in one codebase.
- You want convention-driven routing and deployment adapters.

## Opinionated: when NOT to use SolidStart
- Pure client-side app with minimal routing or static hosting needs.
- Existing backend already defines all rendering/data boundaries cleanly.
- Tiny micro-frontend where framework conventions add overhead.

## Simplicity guidance
- Keep server functions thin and move shared logic to plain TS modules.
- Choose one rendering strategy first; mix modes only when necessary.
- Avoid premature full-stack abstractions until route/data shape stabilizes.

## Sources
- https://docs.solidjs.com/solid-start/
- https://docs.solidjs.com/solid-start/getting-started/what-is-solidstart
- https://docs.solidjs.com/solid-start/reference/config/define-config
- https://docs.solidjs.com/solid-start/reference/file-routing
- https://docs.solidjs.com/solid-start/reference/server/use-server
- https://docs.solidjs.com/solid-start/reference/routing/route-prerender
