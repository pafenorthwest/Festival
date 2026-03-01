# Solid Router (Concise)

Use Solid Router when URL state is part of the product: deep links, history navigation, and shareable app state across desktop/mobile browsers.

## Router commands (quick picks)

### `<Router>` + `<Route>` (route mapping)
```tsx
<Router>
  <Route path="/" component={Home} />
  <Route path="/settings" component={Settings} />
</Router>;
```

### `<A>` (link with active-state support)
```tsx
<nav>
  <A href="/">Home</A>
  <A href="/settings">Settings</A>
</nav>;
```

### `useNavigate` (imperative navigation)
```tsx
const navigate = useNavigate();
const save = async () => (await persist(), navigate("/done"));
return <button onClick={save}>Save</button>;
```

### `useParams` (read path params)
```tsx
const params = useParams<{ id: string }>();
const userId = () => params.id;
return <h1>User {userId()}</h1>;
```

## Opinionated: when to use Router
- Multi-page-feeling apps where URL is part of user workflow.
- Apps needing deep links for support, sharing, or bookmarks.
- Auth/state flows where browser back/forward correctness matters.

## Opinionated: when NOT to use Router
- Single-screen embeds, modals, or widgets with no URL requirements.
- Short-lived internal tools where navigation history adds complexity.
- Prototypes where route structure would be thrown away quickly.

## Simplicity guidance
- Start with flat routes and small layout nesting.
- Keep route loaders minimal; avoid global route-level side effects.
- Prefer explicit links over implicit redirects until behavior is stable.

## Sources
- https://docs.solidjs.com/solid-router/
- https://docs.solidjs.com/solid-router/getting-started/installation-and-setup
- https://docs.solidjs.com/solid-router/reference/components/router
- https://docs.solidjs.com/solid-router/reference/components/route
- https://docs.solidjs.com/solid-router/reference/components/a
- https://docs.solidjs.com/solid-router/reference/primitives/use-navigate
- https://docs.solidjs.com/solid-router/reference/primitives/use-params
