# Dashboard composition ownership

Phase 4B has one active web composition root:

```text
dashboard/page.tsx
  -> DashboardTopBar
  -> DashboardShell
     -> DashboardRail
     -> active section workspace
     -> context/activity inspector
```

The older overview, plan, handoff, insight, and source-panel modules in this
directory are retained as unmounted source material for Phases 4C and 4D.
They are not alternate routes or composition roots. New UI work must enter
through `dashboard/page.tsx` and the shared shell/primitives; do not add new
imports from the retired prototype modules without an explicit phase plan.
