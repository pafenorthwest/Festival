# SolidJS Core (Concise)

Solid core is enough for many browser screens on desktop and mobile: local state, derived values, and reactive side effects without a heavy framework runtime.

## Core commands (quick picks)

### `createSignal` (local reactive state)
```tsx
const [count, setCount] = createSignal(0);
const inc = () => setCount((c) => c + 1);
return <button onClick={inc}>{count()}</button>;
```

### `createMemo` (cheap derived state)
```tsx
const [items] = createSignal([3, 1, 2]);
const sorted = createMemo(() => [...items()].sort());
return <pre>{JSON.stringify(sorted())}</pre>;
```

### `createEffect` (react to changes)
```tsx
const [query, setQuery] = createSignal("");
createEffect(() => console.log("search:", query()));
return <input onInput={(e) => setQuery(e.currentTarget.value)} />;
```

### `onMount` (browser setup after render)
```tsx
const [ready, setReady] = createSignal(false);
onMount(() => setReady(true));
return <span>{ready() ? "hydrated" : "loading"}</span>;
```

### `<For>` and `<Show>` (render lists/branches)
```tsx
const [todos] = createSignal(["Ship", "Measure"]);
const Row = (t: string) => <li>{t}</li>;
return <For each={todos()}>{Row}</For>;
```

```tsx
const [user] = createSignal<{ name: string } | null>(null);
const Name = (u: { name: string }) => <h1>{u.name}</h1>;
return <Show when={user()} fallback={<Login />}>{(u) => <Name {...u()} />}</Show>;
```

## Opinionated defaults
- Start with core only for widgets, dashboards, and single-view tools.
- Prefer component-local signals before introducing global stores.
- Use memos for derivations; avoid effects for pure computations.
- Keep effects for I/O (analytics, storage sync, network triggers).

## TypeScript + browser guidance
- Use TS types at component boundaries; runtime output stays plain browser JavaScript.
- Solid-specific syntax is mostly JSX and reactive primitives; do not over-abstract early.
- Optimize interaction first (tap/scroll/input latency) before adding architecture layers.

## Sources
- https://docs.solidjs.com/
- https://docs.solidjs.com/concepts/signals
- https://docs.solidjs.com/concepts/effects
- https://docs.solidjs.com/concepts/derived-values/memos
- https://docs.solidjs.com/concepts/lifecycle/on-mount
- https://docs.solidjs.com/concepts/control-flow/list-rendering
- https://docs.solidjs.com/concepts/control-flow/conditional-rendering
