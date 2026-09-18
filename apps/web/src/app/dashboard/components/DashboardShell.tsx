import type { ReactNode } from 'react'

type DashboardShellProps = {
  children: ReactNode
  mobileNavigation?: ReactNode
}

export function DashboardShell({ children, mobileNavigation }: DashboardShellProps) {
  return (
    <>
      <div className="grid min-h-0 flex-1 overflow-hidden bg-mm-canvas lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15.75rem_minmax(0,1fr)_17.5rem] 2xl:grid-cols-[16.5rem_minmax(0,1fr)_18.5rem]">
        {children}
      </div>
      {mobileNavigation}
    </>
  )
}
