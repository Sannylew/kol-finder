import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import RequireAuth from "./admin/RequireAuth";
import AdminLayout from "./admin/AdminLayout";
import AdminLogin from "./admin/AdminLogin";
import Dashboard from "./admin/Dashboard";
import KolAdmin from "./admin/KolAdmin";
import RemovedPanel from "./admin/RemovedPanel";
import SourceSettings from "./admin/SourceSettings";
import SyncLogs from "./admin/SyncLogs";
import AppearanceSettings from "./admin/AppearanceSettings";
import SystemLogs from "./admin/SystemLogs";
import BackupPanel from "./admin/BackupPanel";
import ChangePassword from "./admin/ChangePassword";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="kols" element={<KolAdmin />} />
          <Route path="removed" element={<RemovedPanel />} />
          <Route path="source" element={<SourceSettings />} />
          <Route path="sync-logs" element={<SyncLogs />} />
          <Route path="appearance" element={<AppearanceSettings />} />
          <Route path="logs" element={<SystemLogs />} />
          <Route path="backups" element={<BackupPanel />} />
          <Route path="password" element={<ChangePassword />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
