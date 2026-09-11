# Establish Goals

## Status

- Task name: button-component
- Iteration: v0
- State: locked

## Request

- Create one reusable frontend button component for the existing plain, secondary, and compact-header secondary button forms; update the shared button radius and accent color tokens.

## Blocking ambiguity

- Does “Create a component for these buttons” mean migrate every existing native `button` in the frontend, including specialized controls such as icon, workflow-card, and Shopify submit buttons, or only buttons whose markup matches the three forms named in the request?

## Assumptions

- `bullet-accent` changes to `#303240` and `bullet-accent-strong` changes to `#2a2c40`.
- The requested 4px radius applies to the shared button component (not all non-button rounded UI elements).
- Unless otherwise directed, the component will replace only the three named forms: plain `type="button"`, `secondary-button`, and `secondary-button compact-header-button`; specialized button styles will stay native.

## Goals

1. Provide a reusable Solid button component that supports the plain, secondary, and compact-header secondary visual variants while forwarding existing button behavior and attributes.
2. Migrate the button instances within the agreed scope to the component without changing their text, click handlers, disabled behavior, or button type.
3. Set component buttons to a 4px corner radius.
4. Set `--bullet-accent` to `#303240` and `--bullet-accent-strong` to `#2a2c40`.
5. Add or update tests that verify the component usage and requested visual tokens.

## Non-goals

- Do not redesign non-button controls, other layouts, or specialized buttons outside the approved migration scope.
- Do not change unrelated theme tokens or interaction behavior.

## Success criteria

- [G1] The frontend contains one reusable button component supporting the three approved variants.
- [G2] All approved button instances use the component and retain their prior behavior and labels.
- [G3] Component button styling resolves to a 4px border radius.
- [G4] The root CSS variables exactly use `#303240` and `#2a2c40` for the two requested accent tokens.
- [G5] Frontend type-check and relevant tests pass.

## Next action

- Goals approved by the user; hand off to implement.
