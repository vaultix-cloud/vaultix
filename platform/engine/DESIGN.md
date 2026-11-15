# Vaultix design system

This is how Vaultix looks, behaves and speaks. It replaces the inherited "v3" visual system
(docs/0130, phase 1). The code lives in `frontend/src/design-system`; Storybook is the source of
truth, and the component reference at the end of this file is generated from the stories.

Run it: `cd frontend && npm run storybook` (port 6006). Test it:
`npx vitest run src/design-system` from PowerShell on Windows.

## Rules

1. **Vaultix primitives on native HTML.** No shadcn, no Radix, no third-party primitive kits.
   Each primitive follows the matching WAI-ARIA Authoring Practices pattern and adds no
   dependency. The rest of the app may only use Radix less over time
   (`scripts/check-design-system.mjs` holds a ceiling that may only fall).
2. **Tokens only.** Every colour, size, radius, shadow, duration and easing comes from a
   `--vx-*` token. A colour literal outside `tokens/` fails the build.
3. **Every component has a story, a keyboard spec and an accessibility test.** The story's
   description states the keyboard model; its play function proves it; `a11y: { test: "error" }`
   makes any axe violation fail the build. The build runs these stories in a real browser.
4. **WCAG 2.2 AA** in both themes. Contrast is computed by the token build and enforced, not
   eyeballed.
5. **Values never appear.** No secret value in any UI copy, toast, error, log, screenshot or
   story. Refer to secrets by name or reference.

## Tokens

Three layers in W3C Design Tokens format under `frontend/src/design-system/tokens/source/`:

| Layer | File | Holds | Example |
| --- | --- | --- | --- |
| Primitive | `primitive.json` | Raw values only: OKLCH colour scales, spacing, radius, type, motion, z | `color.gold.500` |
| Semantic | `semantic.dark.json`, `semantic.light.json` | Roles, one value per theme | `color.text.secondary`, `color.accent.solid` |
| Component | `component.json` | What a component draws with, pointing at semantic roles | `input.border`, `menu-item.bg-highlight` |

`node scripts/build-tokens.mjs` (from `frontend/`) writes `tokens.css` and a typed `tokens.ts`.
Components never reference primitives. Dark is the default theme; `data-theme="light"` on any
ancestor switches everything inside it, because component tokens are declared again in each
theme scope. Reduced motion sets durations to zero.

**Contrast gate.** `contrast.json` lists every foreground and background pair that must be
readable, with its minimum: 4.5:1 for text, 3:1 for icons, control borders, state graphics and
focus rings. The build computes each pair in both themes and refuses a palette that fails. When
you add a component token that draws text or a state, add its pairs.

Roles worth knowing:

- `color.accent.base` is the gold for filled buttons. `color.accent.solid` is the gold for
  graphics that carry state (a checked box, an on switch) and meets 3:1 on surfaces in both
  themes; in light it is a deeper gold with a white mark.
- `color.status.danger-strong` is danger text on tinted or highlighted backgrounds.
- `color.interactive.highlight` is the option under the pointer or keyboard in a floating list.
- `color.surface.field` is the fill behind typed text: recessed in dark, white in light.
- `elevation.overlay` and `color.backdrop` are for dialogs, sheets, menus and popovers.

## Type, space and shape

- **Type.** Inter for the interface; JetBrains Mono for names, keys, references and code. Sizes
  12, 13, 14 (body), 16, 18, 22, 28. Controls use 14; touch screens get 16 in text fields so the
  page does not zoom.
- **Space.** A 4-pixel scale (`--vx-space-1` = 4px ... `--vx-space-16` = 64px), with 2, 6 and 10
  for fine adjustments.
- **Shape.** Radius 4 (small), 6 (controls), 10 (cards, dialogs), 14, and full.
- **Controls.** Heights 28, 32 (default) and 40. Press targets are at least 24 by 24
  (WCAG 2.5.8); a checkbox's whole label row is its target.

## Interaction and accessibility

- **Focus** is a 2px gold ring offset by 2px, shown for keyboard focus (`:focus-visible`). Lists
  that move focus with arrows show the ring inside the row as well as the fill.
- **Keyboard models** follow the APG: roving focus in menus and tabs, `aria-activedescendant` in
  the combobox, native behaviour for radios, selects and checkboxes. Escape closes the innermost
  layer first (a tooltip, then its toast or popover).
- **Layers** use the platform: `<dialog>` with `showModal()` for Dialog and Sheet (inert page,
  focus kept inside), the Popover API for tooltips, popovers and menus (top layer, no portals).
  Focus returns to the control that opened a layer.
- **Names and descriptions.** Every control has a visible label; icon-only buttons take a
  required label shown as their tooltip. Hints and errors are linked with `aria-describedby`;
  errors are prefixed "Error:" for screen readers and never shown by colour alone.
- **Announcements** go through live regions that are always present: toasts, filter counts,
  sort order, loading.
- **Time.** Nothing that needs action disappears on a timer it cannot pause (WCAG 2.2.1).
- **Motion** is short and purposeful and stops under reduced motion.

## Voice and content

Copy reads as if one engineer wrote it for another: direct, specific, calm and honest. The
domain is secrets, access and compliance, and the words reflect that.

- **Sentence case everywhere**: buttons, titles, tabs, menu items, column headers ("Add secret",
  "Rotate now", "Delete project"). It reads as plain speech and keeps names like `payments-api`
  distinct. *This changes the inherited Title Case rule.*
- **Lead with the action and name the thing**: "Delete payments-api?", not "Are you sure?".
- **Precise verbs**: rotate, revoke, import, inject, not handle or manage.
- **Calm**: no exclamation marks, no emoji, no cheerleading.
- **Honest**: no "seamless", "powerful" or "blazing-fast" in the product.
- **Hints** are one short sentence saying what to enter or what happens with it.
- **Empty states** say what belongs here and offer the next step.
- **Errors** name the failure and the remedy: "Could not rotate DATABASE_URL: the token lacks
  `secrets:write`." Never "Something went wrong".
- **Destructive confirmations** name the thing and the consequence: "Its 42 secrets and their
  history are deleted for everyone. This cannot be undone."
- **Success toasts** are past tense and specific: "Secret saved", "DATABASE_URL deleted".

## Adding a component

1. Read the APG pattern it follows. Prefer a native element when one exists (`<dialog>`,
   `<select>`, `<input type="checkbox">`).
2. Add component tokens to `component.json` that point at semantic roles, and their pairs to
   `contrast.json`. Run `node scripts/build-tokens.mjs`.
3. Build it under `src/design-system/primitives/<Name>/` with its CSS, using tokens only.
4. Write `<Name>.stories.tsx` with `a11y: { test: "error" }`, a description that states the
   keyboard model, and play functions that prove it. Include a light-theme story.
5. Export it from `src/design-system/index.ts`, then run `node scripts/design-reference.mjs` to
   refresh the reference below.

## Component reference

Generated from the stories; edit the stories, not this section.

<!-- reference:start (generated by frontend/scripts/design-reference.mjs) -->

### Tokens

The token reference, read from the generated `tokens.ts`, so it always matches what the build ships. **Semantic colours** are the roles components draw with, with their dark and light values. **Contrast** lists every pair the build checks, in both themes, weakest first; a palette that fails any of them cannot build. **Scales** show space, radius, type and motion. Edit tokens in `tokens/source/*.json` and run `node scripts/build-tokens.mjs`.

Stories: Colors, ContrastChecks, SpaceTypeAndMotion, LightTheme · [source](frontend/src/design-system/foundations/Tokens.stories.tsx)

### App Frame

The Vaultix app frame. **Rail:** every item is a link inside a `nav` landmark named Main; collapsed, each shows its name as a tooltip on hover and on keyboard focus, and the current page has `aria-current="page"` and the gold indicator. **Full menu:** the menu button (`aria-expanded`, `aria-controls`) opens labelled groups; the choice is remembered per device. **Skip to content** is the first stop for keyboard users. Below 720 px the rail becomes a drawer opened by the same button.

Stories: Collapsed, Expanded, LightTheme · [source](frontend/src/design-system/frame/AppFrame.stories.tsx)

### Icons

Vaultix's own line icons on a 16-unit grid with a 1.5 stroke, drawn in `currentColor`. Use `<Icon name="lock" />`. Icons are **decorative by default** (`aria-hidden`): put them beside text or inside a control that has a name, such as IconButton, which requires a label. Give `label` only when the icon alone carries meaning; it then has `role="img"` and that name. Sizes: 16 in dense UI and inline text, 20 in navigation and empty states.

Stories: All, Small, Labelled, LightTheme · [source](frontend/src/design-system/icons/Icon.stories.tsx)

### Button

A native `<button>`. **Keyboard:** Tab focuses it; Enter and Space press it. Focus shows a token ring only for keyboard focus (`:focus-visible`). **Busy** keeps the button focusable and sets `aria-busy` and `aria-disabled`, so its state is announced and presses are ignored; **disabled** uses the native attribute and leaves the tab order.

Stories: Primary, Secondary, Ghost, Danger, Sizes, KeyboardPress, Busy, Disabled, LightTheme · [source](frontend/src/design-system/primitives/Button/Button.stories.tsx)

### Checkbox

A native checkbox drawn with tokens; the whole label row is the press target (at least 24 px tall). **Keyboard:** Tab focuses it and Space toggles it. A **description** is linked with `aria-describedby`. **Indeterminate** (mixed) is for a checkbox that stands for several others, some chosen; pressing it chooses all or none. Group related checkboxes in a **Fieldset**, whose legend names the group and whose hint and error describe it. The checked box meets 3:1 against its surface in both themes, and Windows high contrast keeps the state visible.

Stories: Basic, Indeterminate, GroupWithError, LightTheme · [source](frontend/src/design-system/primitives/Choice/Checkbox.stories.tsx)

### Combobox

The WAI-ARIA editable combobox with list autocomplete, for choosing from a long list. Focus stays in the text box; the active option is conveyed with `aria-activedescendant`, and a polite status says how many options match. The value must be one of the options: leaving the box puts back the chosen option's label. **Keyboard:** typing filters by label and description and opens the list; Down and Up Arrow open the list and move through options, skipping disabled ones; Alt+Down opens without moving and Alt+Up closes; Enter chooses the active option; Escape closes the list, or clears the box when the list is closed. A press on an option chooses it. Use Select for short lists.

Stories: Keyboard, Filter, RevertsOnLeave, LightTheme · [source](frontend/src/design-system/primitives/Combobox/Combobox.stories.tsx)

### Dialog

A modal dialog on the native `<dialog>` with `showModal()`: it sits in the top layer, the page behind is inert and does not scroll, and focus stays inside. It is named by its title (`aria-labelledby`) and described by its description (`aria-describedby`). **Keyboard:** on open, focus goes to `initialFocus`, else the first control in the content, else the footer, else the title. Tab and Shift+Tab move through the dialog only. **Escape** closes it, as do the Close button and a press on the backdrop, unless `dismissible` is off. On close, focus returns to the element that opened it. Use `role="alertdialog"` for an interrupting confirmation, with a description and the safe choice focused first.

Stories: Basic, CloseButtonAndBackdrop, NotDismissible, ConfirmDelete, Open, OpenLightTheme · [source](frontend/src/design-system/primitives/Dialog/Dialog.stories.tsx)

### Empty State

What a list or page shows when it has nothing yet, or when a filter matches nothing. It says what belongs here and offers the next step. The title is a real heading at the level the page outline needs (`headingLevel`); the icon is decorative. **Keyboard:** it adds no Tab stops of its own; Tab reaches its actions.

Stories: Basic, NoMatches, LightTheme · [source](frontend/src/design-system/primitives/EmptyState/EmptyState.stories.tsx)

### Field

Wraps one control with its visible **label**, optional **hint** and **error**. The label is a native `<label for>`, so pressing it focuses the control. The hint and error are joined into the control's `aria-describedby`; an error also sets `aria-invalid` and is prefixed with a hidden "Error:" so it is never conveyed by colour alone. **Required** sets the native attribute (announced by screen readers) and shows the word Required. **Keyboard:** the Field adds no tab stop; Tab reaches the control. Put the hint and error before the control so they are read first.

Stories: Basic, WithHint, Required, WithError, Disabled, LightTheme · [source](frontend/src/design-system/primitives/Field/Field.stories.tsx)

### Fieldset

A native `<fieldset>` whose `<legend>` names a group of checkboxes, radios or switches; screen readers announce the legend when focus enters the group. The hint and error describe the group. **Disabled** disables every control inside. **Keyboard:** the fieldset adds no Tab stop; each control inside keeps its own keyboard behaviour.

Stories: Basic, Disabled, Horizontal, LightTheme · [source](frontend/src/design-system/primitives/Fieldset/Fieldset.stories.tsx)

### Link

A native `<a>` for navigation; use Button for actions. Links stay **underlined**, so they are never told apart by colour alone (WCAG 1.4.1); hover thickens the line. **External** links open in a new tab with an icon and a spoken "(opens in a new tab)", and never share the opener or referrer. **Subtle** takes the surrounding text colour. A router's own link can look the same with `linkClassName()`. **Keyboard:** Tab focuses it and Enter follows it.

Stories: Inline, External, Subtle, LightTheme · [source](frontend/src/design-system/primitives/Link/Link.stories.tsx)

### Menu Button

The WAI-ARIA menu button. The button has `aria-haspopup="menu"` and `aria-expanded`, and names the menu. Items come from data (`items`), so a catalog can supply them. **Keyboard on the button:** Enter, Space or Down Arrow opens the menu on the first item; Up Arrow opens it on the last. **In the menu:** Down and Up Arrow move and wrap; Home and End go to the first and last; typing letters jumps to the next item that starts with them; Enter or Space chooses the item, closes the menu and returns focus to the button; Escape closes and returns focus; Tab closes and moves on. Disabled items stay reachable so people learn they exist, and do nothing. A press outside closes the menu. Shortcuts are shown and exposed with `aria-keyshortcuts`; keyboard focus gets a ring as well as the fill.

Stories: Keyboard, ChooseAnItem, PointerAndOutsidePress, IconTrigger, LightTheme · [source](frontend/src/design-system/primitives/Menu/MenuButton.stories.tsx)

### Popover

A non-modal panel anchored to a button, in the top layer. The button has `aria-expanded`, `aria-controls` and `aria-haspopup="dialog"`; the panel is a `dialog` named by its title or `label`. **Keyboard:** Enter or Space on the button opens it and moves focus to `initialFocus` or the first control inside; Tab moves through it and on to the rest of the page in reading order; Escape closes it and returns focus to the button. A press outside closes it and leaves focus where the press landed. Use Dialog instead when the person must finish or cancel before going on.

Stories: Basic, CloseFromInside, OutsidePress, LightTheme · [source](frontend/src/design-system/primitives/Popover/Popover.stories.tsx)

### Radio Group

Native radios in a **Fieldset**. The browser provides the keyboard model: **Tab** enters the group at the checked radio (or the first) and leaves it in one step; **arrow keys** move and check the next or previous radio, skipping disabled ones. Each option can have a description linked with `aria-describedby`. A hint and error describe the whole group.

Stories: Keyboard, WithError, Horizontal, LightTheme · [source](frontend/src/design-system/primitives/Choice/RadioGroup.stories.tsx)

### Select

A native `<select>` in the text-control box, with Field wiring. It uses the platform's own picker, which is the most dependable for keyboard, screen readers and touch. **Keyboard:** Tab focuses it; Up and Down Arrow change the choice; Alt+Down (or Space) opens the list; typing letters jumps to an option. Options can be grouped. Use **Combobox** when people need to search a long list.

Stories: Basic, Grouped, Required, Disabled, LightTheme · [source](frontend/src/design-system/primitives/Select/Select.stories.tsx)

### Sheet

A modal panel along the inline end of the window, for details and longer forms. It is the Dialog with a different shape and has the same behavior: **Keyboard:** focus moves into it on open and stays inside; Escape, the Close button and a press on the backdrop close it; focus returns to what opened it.

Stories: Basic, Open · [source](frontend/src/design-system/primitives/Sheet/Sheet.stories.tsx)

### Skeleton

Placeholder shapes laid out like the content that is loading. The shapes are hidden from assistive technology; wrap the area in **Loading**, which sets `aria-busy` and says once, politely, what is loading. With reduced motion the shimmer stops and the shapes stay still. **Keyboard:** nothing to reach; placeholders take no focus.

Stories: Basic, LightTheme · [source](frontend/src/design-system/primitives/Skeleton/Skeleton.stories.tsx)

### Switch

An on/off setting that takes effect at once; use a Checkbox when the choice is submitted with a form. A native checkbox with `role="switch"`, so it is announced as on or off. **Keyboard:** Tab focuses it and Space toggles it. The thumb's position shows the state, so it never relies on colour alone, and the on track meets 3:1 against its surface in both themes.

Stories: Basic, SettingsGroup, LightTheme · [source](frontend/src/design-system/primitives/Switch/Switch.stories.tsx)

### Table

A semantic data table, not an ARIA grid, so screen readers' table navigation works and Tab moves only between controls. The **caption** names it. A column can supply **row headers** (`th scope="row"`) so each cell is read with its row's name. **Sortable** columns put a button in the header; the sorted column has `aria-sort`, and a polite status announces the new order. Sorting is the caller's (server or client). With **selection**, each row has a named checkbox and the header a select-all that shows the mixed state. **Loading** marks the table busy and shows skeleton rows; **empty** shows an EmptyState in place of rows. When the table is wider than its box, the box becomes a named, focusable region so keyboard users can scroll it. The header stays in view while the page scrolls.

Stories: Sortable, Selectable, Loading, Empty, NarrowScrolls, Compact, LightTheme · [source](frontend/src/design-system/primitives/Table/Table.stories.tsx)

### Tabs

The WAI-ARIA tabs pattern. The tab list is named by `label`; each tab controls its panel and each panel is labelled by its tab. **Keyboard:** Tab reaches the selected tab only, and Tab again moves into the panel. Left and Right Arrow (Up and Down when vertical) move between tabs and wrap; Home and End go to the first and last. Disabled tabs are skipped. With **automatic** activation a panel shows as soon as its tab has focus; with **manual**, Enter or Space shows it. The selected tab is marked by a bar, colour and weight together, never colour alone.

Stories: Automatic, PanelWithoutControls, Manual, Vertical, LightTheme · [source](frontend/src/design-system/primitives/Tabs/Tabs.stories.tsx)

### Text Area

A native `<textarea>` with the same box, states and Field wiring as Text Input. **Keyboard:** Tab focuses it; Enter adds a line; Tab leaves it (it never traps Tab). **Grow** sizes it to its text where the browser supports `field-sizing`, up to 24 lines; elsewhere it keeps its rows and can be resized vertically.

Stories: Default, Grow, Monospaced, Invalid, LightTheme · [source](frontend/src/design-system/primitives/TextArea/TextArea.stories.tsx)

### Text Input

A native `<input>` in a bordered box that can also hold **leading** and **trailing** content (an icon, a unit, a button). Use it inside a **Field** for its label, hint and error; on its own it needs an `aria-label`. **Keyboard:** Tab focuses the text, then any button in the trailing slot; all native editing keys apply. The box shows the focus ring while anything inside it has focus. **Read-only** keeps the text focusable and selectable with a dashed border; **disabled** leaves the tab order. Pressing the padding or a decorative adornment focuses the text. On touch screens the text is 16 px so the page does not zoom.

Stories: Default, Sizes, Monospaced, WithAdornments, ReadOnly, Disabled, LightTheme · [source](frontend/src/design-system/primitives/TextInput/TextInput.stories.tsx)

### Tooltip

Meets WCAG 2.2 SC 1.4.13. Opens after `--vx-duration-tooltip-delay` on mouse hover and **immediately on keyboard focus**; stays open while the pointer moves onto it; **Escape** closes it without moving focus or pointer; never opens on touch. `kind="label"` names an icon-only control (the tooltip is hidden from assistive tech, so it is not read twice). `kind="description"` links extra text with `aria-describedby`. Rendered in the top layer with the native Popover API.

Stories: Description, IconLabel, AllSides · [source](frontend/src/design-system/primitives/Tooltip/Tooltip.stories.tsx)

### Secret saved

Brief news about something that just happened. Raise one from anywhere with `toast({ title, description, tone, action })`; mount `<Toaster />` once. **Announcements:** two live regions are always in the page, polite for information, success and warning and an alert for errors, so screen readers announce reliably; focus never moves on its own. **Timing (WCAG 2.2.1):** information and success close after 6 s and warnings after 10 s; anything with an action stays at least 10 s; errors stay until dismissed; every timer pauses while the pointer or focus is on the notifications. **Keyboard:** F8 moves focus to the notifications region; Tab reaches each action and Dismiss button; Escape closes the toast that has focus (an open tooltip closes first). Each tone has its own icon shape and a spoken tone word, so colour is never the only signal.

Stories: Announce, KeyboardAndAction, EscapeDismisses, AllTones, LightTheme · [source](frontend/src/design-system/primitives/Toast/Toaster.stories.tsx)

<!-- reference:end -->
