# Goals Extract
- Task name: button-component
- Iteration: v1
- State: locked

## Goals

1. Provide a reusable Solid button component that supports the plain, secondary, and compact-header secondary visual variants while forwarding existing button behavior and attributes.
2. Migrate the button instances within the agreed scope to the component without changing their text, click handlers, disabled behavior, or button type.
3. Set component buttons to a 4px corner radius.
4. Set `--bullet-accent` to `#303240` and `--bullet-accent-strong` to `#2a2c40`.
5. Add or update tests that verify the component usage and requested visual tokens.
6. Replace every `shopify-submit-button` instance with the reusable component's standard primary style, retaining form submission behavior.


## Non-goals

- Do not redesign non-button controls, other layouts, or specialized buttons outside the approved migration scope.
- Do not change unrelated theme tokens or interaction behavior.


## Success criteria

- [G1] The frontend contains one reusable button component supporting the three approved variants.
- [G2] All approved button instances use the component and retain their prior behavior and labels.
- [G3] Component button styling resolves to a 4px border radius.
- [G4] The root CSS variables exactly use `#303240` and `#2a2c40` for the two requested accent tokens.
- [G5] Frontend type-check and relevant tests pass.
- [G6] No frontend `shopify-submit-button` markup or dedicated selector remains; the affected submit actions use the shared primary `Button` component.

