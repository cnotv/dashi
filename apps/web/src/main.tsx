import '@radix-ui/themes/styles.css'
import './styles.css'
import { Theme } from '@radix-ui/themes'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/layout/ToastProvider'
import { useColorScheme } from '@/hooks/useColorScheme'
import { EpicView } from '@/views/EpicView'
import { CredentialsView } from '@/views/CredentialsView'
import { IssuesBoardView } from '@/views/IssuesBoardView'
import { PairView } from '@/views/PairView'
import { SessionsView } from '@/views/SessionsView'
import { UsageView } from '@/views/UsageView'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/sessions" replace /> },
      { path: 'sessions', element: <SessionsView />, handle: { title: 'Sessions' } },
      { path: 'issues', element: <IssuesBoardView />, handle: { title: 'Issues' } },
      { path: 'epics/:owner/:name/:number', element: <EpicView />, handle: { title: 'Epic' } },
      { path: 'usage', element: <UsageView />, handle: { title: 'Usage' } },
      { path: 'credentials', element: <CredentialsView />, handle: { title: 'Credentials' } },
      { path: 'pair', element: <PairView />, handle: { title: 'Connect a machine' } },
    ],
  },
])

const SystemTheme = ({ children }: { children: ReactNode }) => (
  <Theme appearance={useColorScheme()} accentColor="indigo" grayColor="slate" radius="large" panelBackground="translucent">
    {children}
  </Theme>
)

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('The #root element is missing from index.html')

createRoot(rootElement).render(
  <StrictMode>
    <SystemTheme>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SystemTheme>
  </StrictMode>,
)
