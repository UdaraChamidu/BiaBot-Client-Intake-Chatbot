import { NavLink, Route, Routes } from "react-router-dom";

import IntakePage from "./pages/IntakePage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <p className="eyebrow">Bianomics</p>
          <h1>BiaBot Intake Console</h1>
        </div>
        <nav className="nav-tabs">
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? "tab active" : "tab")}
            end
          >
            Client Intake
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) => (isActive ? "tab active" : "tab")}
          >
            Admin
          </NavLink>
        </nav>
      </header>

      <main className="page-wrap">
        <Routes>
          <Route path="/" element={<IntakePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
