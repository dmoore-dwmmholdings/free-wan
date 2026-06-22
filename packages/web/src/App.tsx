import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './routes/LoginPage'
import { ChangePasswordPage } from './routes/ChangePasswordPage'
import { BrowsePage } from './routes/BrowsePage'
import { DetailPage } from './routes/DetailPage'
import { WatchPage } from './routes/WatchPage'
import { CollectionsPage } from './routes/CollectionsPage'
import { ClipsPage } from './routes/ClipsPage'
import { ClipBuilder } from './routes/ClipBuilder'
import { BrandingPage } from './routes/BrandingPage'
import { CommandsPage } from './routes/CommandsPage'
import { RepositoriesPage } from './routes/RepositoriesPage'
import { SystemPage } from './routes/SystemPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <BrowsePage />
          </RequireAuth>
        }
      />
      <Route
        path="/media/:id"
        element={
          <RequireAuth>
            <DetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/watch/:id"
        element={
          <RequireAuth>
            <WatchPage />
          </RequireAuth>
        }
      />
      <Route
        path="/collections"
        element={
          <RequireAuth>
            <CollectionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clips"
        element={
          <RequireAuth>
            <ClipsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clips/new"
        element={
          <RequireAuth>
            <ClipBuilder />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/branding"
        element={
          <RequireAuth>
            <BrandingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/commands"
        element={
          <RequireAuth>
            <CommandsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/repositories"
        element={
          <RequireAuth>
            <RepositoriesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/system"
        element={
          <RequireAuth>
            <SystemPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
