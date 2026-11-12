# Festival registration mockups

Static design previews for the navigation and screens described in [the UI specification](../../festival_registration_ui_spec.md). They are separate from the live frontend and use illustrative data as of March 12, 2027. No API requests are made and no account or registration data is saved.

Open `index.html` in a browser, or preview the folder using PowerShell:

```powershell
python3 -m http.server 8765 --bind 127.0.0.1 --directory specs/mockups/festival-registration
```

The five primary screens are:

1. `index.html` — Registration workspace.
2. `class-registration.html` — Class repertoire editor, with one saved piece and an optional second piece.
3. `cart.html` — Completed registrations; use the preview-state control or remove Piano Solo to demonstrate a missing prerequisite.
4. `my-registrations.html` — Purchased classes grouped by performer, with a festival filter.
5. `edit-registration.html` — Repertoire and accompanist editing; use the preview-state control to show cutoff reached.

My Registrations uses concise **Edit** actions. The adjacent information icon shows **Edit Repertoire / Accompanist** on hover, keyboard focus, or tap, with an accessible tooltip association.

Supporting `performers.html` and `festival-home.html` views make the shared navigation reviewable. Existing account destinations and payment actions show preview dialogs. The gallery does not implement checkout, authentication, performer management, or registration persistence.

Festival Home keeps four simple stacked audience choices: Teachers, Parents, Volunteers, and Accompanists. Soft blue/red/green/gold tints, original-hue leading accents, thin borders, 4 px corners, dark left-aligned labels, and subtle arrows blend the gateway with the rest of the site. The choices remain left-aligned at 60% of the page content width and 64 px high, with approximately 22 px/600 desktop labels and 20 px mobile labels. The page and Register headings use the same restrained hierarchy as the other pages; the heavy banner shadow and **All Memberships** button below are absent. The shared sidebar, simplified header, serif font, and background gradient are unchanged. Its screenshots are supporting previews; the five primary registration screens remain the same.

The shared shell preserves the current site's serif font stack and background gradient. Navigation icons use local assets, so the mockups remain usable offline. The brand/home identity is a plain logo/name link; Cart, account, sign-out, and menu controls retain compact button treatment.

Resize the browser to review the same navigation in three states:

- **1101 px and above:** full sidebar with icons and labels; the sidebar toggle can collapse it manually.
- **761–1100 px:** automatic icon-only rail with accessible destination labels.
- **760 px and below:** hamburger opens the sidebar with icons and text labels.

The `previews` folder contains wide, intermediate/icon-rail, and mobile screenshots, plus the five-screen overview. Supporting Festival Home screenshots show its blended audience-focused styling at each navigation width. Reload a page to reset its illustrative state.
