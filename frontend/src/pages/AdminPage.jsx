import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import {
  getClientProfiles,
  getRequestLogs,
  getServiceOptions,
  updateServiceOptions,
  upsertClientProfile,
  verifyAdminPassword,
} from "../services/adminService";
import { getStoredTheme, toggleTheme } from "../utils/theme";

const NEW_PROFILE_ID = "__new__";

const EMPTY_PROFILE_TEMPLATE = {
  client_name: "",
  client_code: "",
  brand_voice_rules: "",
  words_to_avoid: [],
  required_disclaimers: "",
  preferred_tone: "",
  common_audiences: [],
  default_approver: "",
  subscription_tier: "",
  credit_menu: {},
  turnaround_rules: "",
  compliance_notes: "",
  service_options: [],
};

function parseLines(text) {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function linesToText(lines) {
  return (lines ?? []).join("\n");
}

function normalizeProfile(profile) {
  const normalized = {
    ...EMPTY_PROFILE_TEMPLATE,
    ...profile,
    words_to_avoid: [...(profile?.words_to_avoid ?? [])],
    common_audiences: [...(profile?.common_audiences ?? [])],
    service_options: [...(profile?.service_options ?? [])],
    credit_menu: { ...(profile?.credit_menu ?? {}) },
  };
  return {
    ...normalized,
    required_disclaimers: normalized.required_disclaimers ?? "",
    preferred_tone: normalized.preferred_tone ?? "",
    default_approver: normalized.default_approver ?? "",
    subscription_tier: normalized.subscription_tier ?? "",
    turnaround_rules: normalized.turnaround_rules ?? "",
    compliance_notes: normalized.compliance_notes ?? "",
  };
}

function toCreditRows(creditMenu) {
  const entries = Object.entries(creditMenu ?? {});
  if (entries.length === 0) {
    return [{ name: "", credits: "" }];
  }
  return entries.map(([name, credits]) => ({
    name,
    credits: String(credits),
  }));
}

function sortProfiles(rows) {
  return [...rows].sort((a, b) => a.client_name.localeCompare(b.client_name));
}

function buildCreditMenu(creditRows) {
  const creditMenu = {};
  for (const row of creditRows) {
    const name = row.name.trim();
    const rawCredits = String(row.credits).trim();
    if (!name && !rawCredits) {
      continue;
    }
    if (!name) {
      throw new Error("Each credit menu row needs a service key.");
    }
    const credits = Number.parseInt(rawCredits, 10);
    if (!Number.isInteger(credits) || credits < 0) {
      throw new Error(`Credit value for "${name}" must be a non-negative integer.`);
    }
    creditMenu[name] = credits;
  }
  return creditMenu;
}

export default function AdminPage() {
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [profiles, setProfiles] = useState([]);
  const [selectedClientCode, setSelectedClientCode] = useState(NEW_PROFILE_ID);
  const [profileForm, setProfileForm] = useState({ ...EMPTY_PROFILE_TEMPLATE });
  const [creditRows, setCreditRows] = useState([{ name: "", credits: "" }]);
  const [serviceOptionsText, setServiceOptionsText] = useState("");
  const [logs, setLogs] = useState([]);
  const [logLimit, setLogLimit] = useState(100);

  const [activeTab, setActiveTab] = useState("profiles");
  const [currentTheme, setCurrentTheme] = useState(getStoredTheme());

  const selectedProfileLabel = useMemo(() => {
    if (selectedClientCode === NEW_PROFILE_ID) {
      return "New profile";
    }
    return selectedClientCode || "New profile";
  }, [selectedClientCode]);

  function handleThemeToggle() {
    const next = toggleTheme();
    setCurrentTheme(next);
  }

  function hydrateProfileForm(profile) {
    const normalized = normalizeProfile(profile);
    setProfileForm(normalized);
    setCreditRows(toCreditRows(normalized.credit_menu));
  }

  function setProfileSelection(code, rows) {
    if (!rows.length) {
      setSelectedClientCode(NEW_PROFILE_ID);
      hydrateProfileForm(EMPTY_PROFILE_TEMPLATE);
      return;
    }

    const targetCode = rows.some((profile) => profile.client_code === code)
      ? code
      : rows[0].client_code;
    setSelectedClientCode(targetCode);
    const selected = rows.find((profile) => profile.client_code === targetCode);
    hydrateProfileForm(selected ?? EMPTY_PROFILE_TEMPLATE);
  }

  async function loadAdminData(password, preferredCode = "") {
    const [nextProfilesRaw, nextOptions, nextLogs] = await Promise.all([
      getClientProfiles(password),
      getServiceOptions(password),
      getRequestLogs(password, logLimit),
    ]);

    const nextProfiles = sortProfiles(nextProfilesRaw);
    setProfiles(nextProfiles);
    setServiceOptionsText(linesToText(nextOptions));
    setLogs(nextLogs);

    const desiredCode = preferredCode || selectedClientCode;
    if (desiredCode === NEW_PROFILE_ID) {
      setSelectedClientCode(NEW_PROFILE_ID);
      hydrateProfileForm(EMPTY_PROFILE_TEMPLATE);
      return;
    }
    setProfileSelection(desiredCode, nextProfiles);
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    const password = adminPasswordInput.trim();
    if (!password) {
      setError("Admin password is required.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      await verifyAdminPassword(password);
      setAdminPassword(password);
      setIsAuthenticated(true);
      await loadAdminData(password);
      setNotice("Admin access granted.");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to authenticate admin password.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAdminData() {
    if (!adminPassword) {
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await loadAdminData(adminPassword);
      setNotice("Admin data refreshed.");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to refresh admin data.");
    } finally {
      setLoading(false);
    }
  }

  function startNewProfile() {
    setError("");
    setNotice("");
    setSelectedClientCode(NEW_PROFILE_ID);
    hydrateProfileForm(EMPTY_PROFILE_TEMPLATE);
  }

  function handleProfileSelect(nextCode) {
    setError("");
    setNotice("");
    if (nextCode === NEW_PROFILE_ID) {
      startNewProfile();
      return;
    }
    setProfileSelection(nextCode, profiles);
  }

  function updateProfileField(field, value) {
    setProfileForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function updateCreditRow(index, field, value) {
    setCreditRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value,
      };
      return next;
    });
  }

  function addCreditRow() {
    setCreditRows((prev) => [...prev, { name: "", credits: "" }]);
  }

  function removeCreditRow(index) {
    setCreditRows((prev) => {
      const next = prev.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [{ name: "", credits: "" }];
    });
  }

  async function saveProfile() {
    if (!adminPassword) {
      return;
    }

    const normalizedCode = profileForm.client_code.trim().toUpperCase();
    const normalizedName = profileForm.client_name.trim();
    const normalizedVoiceRules = profileForm.brand_voice_rules.trim();

    if (!normalizedCode || !normalizedName || !normalizedVoiceRules) {
      setError("Client code, client name, and brand voice rules are required.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        ...profileForm,
        client_code: normalizedCode,
        client_name: normalizedName,
        brand_voice_rules: normalizedVoiceRules,
        words_to_avoid: profileForm.words_to_avoid,
        common_audiences: profileForm.common_audiences,
        service_options: profileForm.service_options,
        credit_menu: buildCreditMenu(creditRows),
      };
      const saved = await upsertClientProfile(adminPassword, payload);
      await loadAdminData(adminPassword, saved.client_code);
      setNotice(`Profile saved for ${saved.client_code}.`);
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? requestError?.message ?? "Unable to save profile.");
    } finally {
      setLoading(false);
    }
  }

  async function saveServiceOptions() {
    if (!adminPassword) {
      return;
    }

    const options = parseLines(serviceOptionsText);
    if (!options.length) {
      setError("At least one service option is required.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateServiceOptions(adminPassword, options);
      setServiceOptionsText(linesToText(updated));
      setNotice("Global service options updated.");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to save service options.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshLogs() {
    if (!adminPassword) {
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const nextLogs = await getRequestLogs(adminPassword, logLimit);
      setLogs(nextLogs);
      setNotice("Request logs refreshed.");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to load request logs.");
    } finally {
      setLoading(false);
    }
  }

  function logoutAdmin() {
    setAdminPassword("");
    setAdminPasswordInput("");
    setIsAuthenticated(false);
    setProfiles([]);
    setLogs([]);
    setSelectedClientCode(NEW_PROFILE_ID);
    hydrateProfileForm(EMPTY_PROFILE_TEMPLATE);
    setError("");
    setNotice("");
  }

  const adminTopbar = (
    <div className="admin-topbar">
      <div className="chat-topbar-left">
        <div className="chat-top-titles">
          <div className="topbar-brand">
            <img src="/avatar.png" alt="biaBot" className="topbar-avatar" />
            <div>
              <p className="chatbot-tag">BiaBot</p>
              <h2>{isAuthenticated ? "Admin Console" : "Admin Login"}</h2>
            </div>
          </div>
        </div>
      </div>
      <div className="chat-topbar-right">
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
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={handleThemeToggle}
          aria-label="Toggle theme"
        >
          {currentTheme === "dark" ? "Light" : "Dark"}
        </button>
        {isAuthenticated && (
          <>
            <button type="button" className="ghost-btn" onClick={refreshAdminData} disabled={loading}>
              {loading ? "Working..." : "Refresh All"}
            </button>
            <button type="button" className="ghost-btn danger-text" onClick={logoutAdmin} disabled={loading}>
              Sign Out
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <section className="admin-login-screen">
        {adminTopbar}

        <div className="admin-login-stack">
          {error && <p className="error-banner">{error}</p>}

          <form className="admin-login-card" onSubmit={handleAdminLogin}>
            <div className="admin-login-header">
              <div className="admin-login-icon">B</div>
              <h2>Admin Login</h2>
            </div>
            <p className="admin-login-copy">Enter your admin password to access the management console.</p>

            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              value={adminPasswordInput}
              onChange={(event) => setAdminPasswordInput(event.target.value)}
              placeholder="Enter admin password"
              autoComplete="current-password"
            />
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <div className="admin-layout">
      {adminTopbar}

      {error && <p className="error-banner">{error}</p>}
      {notice && <p className="status-banner">{notice}</p>}

      <nav className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${activeTab === "profiles" ? "active" : ""}`}
          onClick={() => setActiveTab("profiles")}
        >
          Client Profiles
          {profiles.length > 0 && <span className="tab-badge">{profiles.length}</span>}
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "services" ? "active" : ""}`}
          onClick={() => setActiveTab("services")}
        >
          Services
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "logs" ? "active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Request Logs
          {logs.length > 0 && <span className="tab-badge">{logs.length}</span>}
        </button>
      </nav>

      <div className="admin-tab-content">
        {activeTab === "profiles" && (
          <div className="admin-section">
            <div className="admin-profiles-grid">
              <article className="panel">
                <div className="panel-header">
                  <h3>Client Profiles</h3>
                  <button type="button" className="ghost-btn" onClick={startNewProfile} disabled={loading}>
                    + New Profile
                  </button>
                </div>
                <div className="admin-row">
                  <label htmlFor="profile-select">Select profile</label>
                  <select
                    id="profile-select"
                    value={selectedClientCode}
                    onChange={(event) => handleProfileSelect(event.target.value)}
                  >
                    <option value={NEW_PROFILE_ID}>+ New Profile</option>
                    {profiles.map((profile) => (
                      <option key={profile.client_code} value={profile.client_code}>
                        {profile.client_name} ({profile.client_code})
                      </option>
                    ))}
                  </select>
                </div>

                <p className="muted-text">Editing: {selectedProfileLabel}</p>

                <div className="admin-form-grid">
                  <label className="admin-field">
                    Client Name
                    <input
                      value={profileForm.client_name}
                      onChange={(event) => updateProfileField("client_name", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    Client Code
                    <input
                      value={profileForm.client_code}
                      onChange={(event) => updateProfileField("client_code", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    Subscription Tier
                    <input
                      value={profileForm.subscription_tier}
                      onChange={(event) => updateProfileField("subscription_tier", event.target.value)}
                      placeholder="Tier 1 / Tier 2"
                    />
                  </label>
                  <label className="admin-field">
                    Default Approver
                    <input
                      value={profileForm.default_approver}
                      onChange={(event) => updateProfileField("default_approver", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    Preferred Tone
                    <input
                      value={profileForm.preferred_tone}
                      onChange={(event) => updateProfileField("preferred_tone", event.target.value)}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Brand Voice Rules
                    <textarea
                      rows="3"
                      value={profileForm.brand_voice_rules}
                      onChange={(event) => updateProfileField("brand_voice_rules", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    Words To Avoid (one per line)
                    <textarea
                      rows="4"
                      value={linesToText(profileForm.words_to_avoid)}
                      onChange={(event) =>
                        updateProfileField("words_to_avoid", parseLines(event.target.value))
                      }
                    />
                  </label>
                  <label className="admin-field">
                    Common Audiences (one per line)
                    <textarea
                      rows="4"
                      value={linesToText(profileForm.common_audiences)}
                      onChange={(event) =>
                        updateProfileField("common_audiences", parseLines(event.target.value))
                      }
                    />
                  </label>
                  <label className="admin-field">
                    Service List For This Client (one per line)
                    <textarea
                      rows="4"
                      value={linesToText(profileForm.service_options)}
                      onChange={(event) =>
                        updateProfileField("service_options", parseLines(event.target.value))
                      }
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Required Disclaimers
                    <textarea
                      rows="3"
                      value={profileForm.required_disclaimers}
                      onChange={(event) => updateProfileField("required_disclaimers", event.target.value)}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Turnaround Rules
                    <textarea
                      rows="3"
                      value={profileForm.turnaround_rules}
                      onChange={(event) => updateProfileField("turnaround_rules", event.target.value)}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Compliance Notes
                    <textarea
                      rows="3"
                      value={profileForm.compliance_notes}
                      onChange={(event) => updateProfileField("compliance_notes", event.target.value)}
                    />
                  </label>
                </div>

                <button type="button" className="primary-btn" onClick={saveProfile} disabled={loading}>
                  {loading ? "Saving..." : "Save Client Profile"}
                </button>
              </article>

              <article className="panel">
                <h3>Credit Menu</h3>
                <p className="muted-text">Define credits by service key for {selectedProfileLabel}.</p>
                <div className="credit-menu-list">
                  {creditRows.map((row, index) => (
                    <div className="credit-menu-row" key={`${index}-${row.name}`}>
                      <input
                        value={row.name}
                        onChange={(event) => updateCreditRow(index, "name", event.target.value)}
                        placeholder="service_key"
                      />
                      <input
                        type="number"
                        min="0"
                        value={row.credits}
                        onChange={(event) => updateCreditRow(index, "credits", event.target.value)}
                        placeholder="credits"
                      />
                      <button
                        type="button"
                        className="ghost-btn danger-text"
                        onClick={() => removeCreditRow(index)}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="admin-row">
                  <button type="button" className="ghost-btn" onClick={addCreditRow} disabled={loading}>
                    + Add Credit Item
                  </button>
                  <button type="button" className="primary-btn" onClick={saveProfile} disabled={loading}>
                    {loading ? "Saving..." : "Save Credit Menu"}
                  </button>
                </div>
              </article>
            </div>
          </div>
        )}

        {activeTab === "services" && (
          <div className="admin-section">
            <article className="panel">
              <h3>Global Service List Options</h3>
              <p className="muted-text">These options appear when a client profile does not override them.</p>
              <textarea
                rows="12"
                value={serviceOptionsText}
                onChange={(event) => setServiceOptionsText(event.target.value)}
                placeholder="One service option per line"
              />
              <button type="button" className="primary-btn" onClick={saveServiceOptions} disabled={loading}>
                {loading ? "Saving..." : "Save Service Options"}
              </button>
            </article>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="admin-section">
            <article className="panel">
              <div className="logs-controls">
                <h3>Request Logs</h3>
                <label htmlFor="logs-limit">Limit</label>
                <select
                  id="logs-limit"
                  value={String(logLimit)}
                  onChange={(event) => setLogLimit(Number.parseInt(event.target.value, 10))}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
                <button type="button" className="ghost-btn" onClick={refreshLogs} disabled={loading}>
                  Refresh Logs
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Client</th>
                      <th>Service</th>
                      <th>Project</th>
                      <th>Monday Item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty-table-cell">No request logs found.</td>
                      </tr>
                    )}
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.created_at).toLocaleString()}</td>
                        <td><span className="table-badge">{log.client_code}</span></td>
                        <td>{log.service_type}</td>
                        <td>{log.project_title}</td>
                        <td>{log.monday_item_id ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
