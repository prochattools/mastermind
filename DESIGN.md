# Mastermind Design System

## Status

Canonical design source of truth for the Mastermind Local dashboard and product UI.

This document guides the public, self-hosted Mastermind Local experience only.

## Product design goal

Mastermind Local should feel like a compact local AI companion for moving from context to safe execution.

The dashboard should make the user feel:

- Mastermind knows which sources are connected
- Mastermind understands the current project context
- Mastermind can show the active plan or execution packet
- Mastermind knows the next useful action
- Mastermind can help continue or resume work without terminal anxiety

## Design direction

Use this direction:

> ChatGPT app familiarity + Codex app shell + Linear density + Vercel precision + Apple restraint

## Dashboard target visual

The current target dashboard is the generated three-panel Mastermind mockup with:

1. **Overview dashboard**
   - compact greeting/summary header
   - four small metric cards for sources, indexed files, plans, and tasks
   - activity overview and model/usage style confidence blocks
   - recent activity, top sources, recent plans, workflow, and system status panels

2. **Context & Sources**
   - source list as the primary object
   - source health summary
   - indexed content summary
   - most active sources
   - context mode controls at the bottom

3. **Plans & Tasks**
   - active plans with progress bars
   - task overview filters
   - task rows with status and priority-like state markers
   - progress/productivity cards

Implementation rules for this target:

- keep the existing Mastermind Local routes, actions, and data contracts intact
- keep the Codex/ChatGPT-style app shell with left rail, main workspace, and right inspector
- make dashboard pages visually richer through real local data, not decorative filler
- use compact cards and rows, not oversized panels
- use color only for state and progress
- avoid page scroll; use contained panel scrolling only
- design the dashboard around useful product surfaces: overview, sources, plans, activity, handoff, settings

Meaning:

- ChatGPT app familiarity: clear sections, calm hierarchy, obvious interaction patterns
- Codex app shell: compact workspace rail, dense but readable operational layout
- Linear density: efficient spacing, precise alignment, no waste
- Vercel precision: restrained surfaces, crisp typography, polished chrome
- Apple restraint: premium, calm, and minimal without becoming sterile

Avoid:

- generic AI gradients
- cockpit-style developer clutter
- dense analytics dashboards
- neon cyber styling
- excessive cards and borders
- decorative motion that does not help the workflow
- default admin-template surfaces
- pill-shaped controls as the default button style
- handmade inline SVG icon sets
- mixed icon styles or inconsistent stroke weights
- status text that overflows narrow inspector panels
- badge-heavy source rows when plain text and dots are enough

## Core dashboard rule: no page scroll

The Mastermind dashboard is a dashboard, not a scrolling website.

The main `/dashboard` page should fit within the viewport and should not require vertical page scrolling during normal use.

Rules:

- the whole dashboard page should use a fixed viewport layout
- primary content should be visible above the fold
- avoid long stacked sections that push the page downward
- use tabs, panels, drawers, side navigation, split panes, or modals when more information is needed
- scrolling is allowed inside contained panels only when necessary
- examples of acceptable internal scroll areas:
  - source list panel
  - activity/timeline panel
  - execution packet preview
  - advanced/debug drawer
  - full prompt preview
- the browser page itself should not become the main navigation mechanism

Implementation implication:

- prefer `h-screen`, `overflow-hidden`, and contained `overflow-auto` panel regions
- test at common laptop sizes, especially 1440×900 and 1366×768
- if content does not fit, reduce density or move secondary details behind progressive disclosure instead of adding page scroll

## Dashboard information hierarchy

The first screen should answer, in this order:

1. What is connected?
2. Is Mastermind healthy?
3. What project or workspace am I in?
4. What plan or execution packet is active?
5. What should I do next?
6. What has already happened?
7. What can I inspect if I need more detail?

The user should not need to scan a wall of widgets to understand the next step.

## Primary dashboard layout

Recommended desktop layout:

1. Top bar
   - Mastermind identity
   - current dashboard section
   - compact agent/source/write status
   - light/dark mode toggle
   - refresh and settings entry

2. Left rail or sidebar
   - Overview
   - Sources
   - Activity
   - Plans
   - Handoff
   - Settings
   - compact source/repo browser if space allows

3. Main panel
   - current build flow
   - active plan or execution packet
   - one primary next action
   - concise task progress

4. Right inspector panel
   - source/context health
   - agent health
   - latest event
   - prompt handoff shortcuts

5. Internal drawers/details
   - advanced debug state
   - raw paths
   - raw output
   - full packet preview
   - long prompt text

The default view should fit in one viewport without page scroll.

## Mastermind Local scope

The public Mastermind repo is Local-only.

Include:

- local source status
- connect/disconnect source entry points
- active context mode
- local agent health
- current plan or execution packet preview
- simple task status model
- next recommended action
- copy-ready Codex prompt
- copy-ready Claude Code prompt
- local timeline/checklist preview
- empty/loading/error/connected states

Do not include:

- managed product messaging
- cloud sync
- aggressive upsells
- future roadmap text that is not part of Mastermind Local

## Visual principles

Use:

- shared dashboard UI primitives for buttons, icon buttons, panels, rows, status, and headers
- high-quality spacing
- precise alignment
- restrained color
- strong text hierarchy
- subtle borders
- soft shadows only when useful
- status indicators that are easy to understand
- calm empty states
- crisp hover and focus states
- one consistent icon source or no icons at all
- small dots plus plain text for secondary state
- professional icons from one source only, or no icons if consistency cannot be maintained
- flat panels and subtle surfaces by default; reserve stronger elevation for rare emphasis
- a single information owner for each data point so the same state is not repeated across top bar, rail, main view, and inspector

Avoid:

- too many cards
- too many icons
- too many colors
- giant hero sections
- long marketing copy inside the dashboard
- gradients as the primary design language
- visual density that creates intimidation
- rounded-full buttons and chips unless they are tiny dots
- strongly boxed card grids as the default layout pattern

## Typography

Typography should feel modern, precise, and readable.

Guidelines:

- use the project font stack:
  - UI text: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`
  - code/prompt/path text: `"JetBrainsMono Nerd Font", "JetBrains Mono", "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- prefer clear hierarchy over decorative typography
- keep body copy concise
- use sentence case for labels and headings
- avoid all-caps except for tiny status labels where useful
- use tabular numbers for counts, task progress, and status metrics if available

Suggested hierarchy:

- page title: calm and compact, not huge
- section titles: small but clear
- labels: muted and readable
- status values: visually stronger than labels
- helper text: short, plain language
