import { NavLink, Route, Routes, useLocation } from "react-router-dom";

import IntakePage from "./pages/IntakePage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  const location = useLocation();
  const isIntakeRoute = location.pathname === "/";

  return (
    <div className={`app-shell ${isIntakeRoute ? "intake-shell" : ""}`}>
      <header className="app-header">
        <div className="brand">
          <p className="eyebrow">Bianomics</p>
          <h1>Chat with BiaBot</h1>
          {/* <h1>BiaBot Intake Console</h1> */}
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

      <main className={`page-wrap ${isIntakeRoute ? "intake-wrap" : ""}`}>
        <Routes>
          <Route path="/" element={<IntakePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
