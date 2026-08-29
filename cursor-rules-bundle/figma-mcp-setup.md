# Connecting Cursor to Figma (Dev Mode MCP Server)

Rules files alone can't give Cursor real design values — they only constrain
*how* Cursor uses values it's given. To get exact colors/spacing/type from your
Figma file, connect Cursor to Figma directly so it can inspect real nodes.

## Setup

1. **In Figma**: open the file → toggle **Dev Mode** (top right, `</>` icon).
   Dev Mode is available on Figma's free plan for files you have edit/view
   access to — you don't need a paid seat just to enable it, though some
   advanced Dev Mode features require a paid plan. Check your workspace's
   current plan if a feature seems gated.
2. In Figma, go to the Dev Mode panel and look for **"MCP Server"** — Figma
   ships an official Dev Mode MCP server that exposes design data to AI
   tools. Enable it; it typically runs locally and gives you a local server
   URL (commonly `http://127.0.0.1:3845/sse` or similar — Figma will show you
   the exact address).
3. **In Cursor**: go to `Cursor Settings → MCP` → **Add new MCP server**.
   Add the Figma server using the URL/config Figma gave you. Cursor will list
   it as an available tool source once connected.
4. Confirm the connection by opening a Cursor chat and asking: *"List the
   available Figma MCP tools."* You should see tools like `get_code`,
   `get_variable_defs`, `get_image`, or similar (exact names depend on Figma's
   current MCP server version).

## Using it

- Select a specific frame/component in Figma (e.g. the upload screen, the
  question-list item component).
- In Cursor chat, reference that selection and ask Cursor to run
  `get_variable_defs` or `get_code` against it.
- Ask Cursor to translate the output into entries for
  `.cursor/rules/design-tokens.mdc` — this replaces the `TODO`s with real
  values instead of you copying them by hand.
- Repeat per screen/component as you build each one, rather than trying to
  extract the entire file at once.

## If the MCP server isn't available or doesn't work

Fall back to manual extraction — still solid, just more manual:
1. In Figma Dev Mode, click any layer.
2. The right panel shows exact CSS-equivalent values (hex colors, font
   size/weight/line-height, padding, gap, border-radius, box-shadow).
3. Copy these into `design-tokens.mdc` by hand, one section at a time.
4. For assets (icons, illustrations), use Figma's **Export** panel (select
   layer → Export → PNG/SVG) and drop them into `/public`.

## Why this matters for this assignment

The brief says to "follow the provided design closely." Evaluators will likely
compare your deployed app side-by-side with the Figma frames. Guessing spacing
and colors from a screenshot will drift visibly; pulling exact Dev Mode values
won't. This step is worth the 20–30 minutes it takes, especially since the
rest of the build (extraction, mapping, grading) is where most of your
engineering time should go — get the design values locked in once, up front,
so you're not re-eyeballing them screen by screen.
