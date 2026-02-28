import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import {
  deleteClientProfile,
  getClientProfiles,
  getRequestLogs,
  getServiceOptions,
  updateServiceOptions,
  upsertClientProfile,
  verifyAdminPassword,
} from "../services/adminService";
import { getStoredTheme, toggleTheme } from "../utils/theme";

const NEW_PROFILE_ID = "__new__";

const PROFILE_PLACEHOLDERS = {
  client_name: "ReadyOne Industries",
  client_code: "READYONE01",
  brand_voice_rules: "Direct, confident, workforce-centered. Avoid corporate fluff.",
  words_to_avoid: "empowerment journey\ndisruption",
  required_disclaimers: "EOE employer statement required on recruitment materials.",
  preferred_tone: "confident and straightforward",
  common_audiences: "job seekers\nemployers\ninternal staff",
  default_approver: "Lupita R.",
  subscription_tier: "Tier 2",
  turnaround_rules: "Standard: 5 business days. Urgent: 48 hours.",
  compliance_notes: "Use approved legal templates for external statements.",
  service_options: "Campaign set (up to 6 assets)\nCustom graphic",
  credit_service_key: "custom_graphic",
  credit_value: "25",
};

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

function displayValue(value, fallback = "Not set") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clientInitials(name) {
  const text = String(name ?? "").trim();
  if (!text) {
    return "C";
  }
  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return text.slice(0, 2).toUpperCase();
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
  const [clientDirectoryQuery, setClientDirectoryQuery] = useState("");
  const [logsQuery, setLogsQuery] = useState("");

  const [activeTab, setActiveTab] = useState("profiles");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [currentTheme, setCurrentTheme] = useState(getStoredTheme());

  const selectedProfileLabel = useMemo(() => {
    if (selectedClientCode === NEW_PROFILE_ID) {
      return "New profile";
    }
    return selectedClientCode || "New profile";
  }, [selectedClientCode]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.client_code === selectedClientCode) ?? null,
    [profiles, selectedClientCode]
  );

  const filteredProfiles = useMemo(() => {
    const query = clientDirectoryQuery.trim().toLowerCase();
    if (!query) {
      return profiles;
    }
    return profiles.filter((profile) => {
      const searchable = [
        profile.client_name,
        profile.client_code,
        profile.subscription_tier,
        profile.preferred_tone,
        profile.default_approver,
      ];
      return searchable.some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [profiles, clientDirectoryQuery]);

  const serviceOptionItems = useMemo(
    () => parseLines(serviceOptionsText),
    [serviceOptionsText]
  );

  const creditSummary = useMemo(() => {
    let configuredItems = 0;
    let totalCredits = 0;
    for (const row of creditRows) {
      const serviceKey = String(row.name ?? "").trim();
      const credits = Number.parseInt(String(row.credits ?? ""), 10);
      if (!serviceKey || !Number.isInteger(credits) || credits < 0) {
        continue;
      }
      configuredItems += 1;
      totalCredits += credits;
    }
    return { configuredItems, totalCredits };
  }, [creditRows]);

  const filteredLogs = useMemo(() => {
    const query = logsQuery.trim().toLowerCase();
    if (!query) {
      return logs;
    }
    return logs.filter((log) => {
      const searchable = [
        log.client_code,
        log.client_name,
        log.service_type,
        log.project_title,
        log.monday_item_id,
      ];
      return searchable.some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [logs, logsQuery]);

  function handleThemeToggle() {
    const next = toggleTheme();
    setCurrentTheme(next);
  }

  function handleNotificationsToggle() {
    setNotificationsEnabled((prev) => !prev);
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

  function validateProfileForm() {
    const requiredTextFields = [
      ["client_code", "Client code"],
      ["client_name", "Client name"],
      ["brand_voice_rules", "Brand voice rules"],
      ["required_disclaimers", "Required disclaimers"],
      ["preferred_tone", "Preferred tone"],
      ["default_approver", "Default approver"],
      ["subscription_tier", "Subscription tier"],
    ];

    for (const [field, label] of requiredTextFields) {
      const value = String(profileForm[field] ?? "").trim();
      if (!value) {
        return `${label} is required.`;
      }
    }

    if (!profileForm.words_to_avoid?.length) {
      return "Words to avoid requires at least one item.";
    }
    if (!profileForm.common_audiences?.length) {
      return "Common audiences requires at least one item.";
    }

    try {
      buildCreditMenu(creditRows);
    } catch (validationError) {
      return validationError?.message ?? "Credit menu is invalid.";
    }

    return "";
  }

  async function saveProfile() {
    if (!adminPassword) {
      return;
    }

    const validationError = validateProfileForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const normalizedCode = profileForm.client_code.trim().toUpperCase();
    const normalizedName = profileForm.client_name.trim();
    const normalizedVoiceRules = profileForm.brand_voice_rules.trim();
    const normalizedDisclaimers = profileForm.required_disclaimers.trim();
    const normalizedTone = profileForm.preferred_tone.trim();
    const normalizedApprover = profileForm.default_approver.trim();
    const normalizedTier = profileForm.subscription_tier.trim();
    const normalizedTurnaroundRules = profileForm.turnaround_rules.trim();
    const normalizedComplianceNotes = profileForm.compliance_notes.trim();
    const normalizedWordsToAvoid = profileForm.words_to_avoid.map((item) => item.trim()).filter(Boolean);
    const normalizedCommonAudiences = profileForm.common_audiences.map((item) => item.trim()).filter(Boolean);
    const normalizedServiceOptions = profileForm.service_options.map((item) => item.trim()).filter(Boolean);

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
        words_to_avoid: normalizedWordsToAvoid,
        required_disclaimers: normalizedDisclaimers,
        preferred_tone: normalizedTone,
        common_audiences: normalizedCommonAudiences,
        default_approver: normalizedApprover,
        subscription_tier: normalizedTier,
        turnaround_rules: normalizedTurnaroundRules || null,
        compliance_notes: normalizedComplianceNotes || null,
        service_options: normalizedServiceOptions,
        credit_menu: buildCreditMenu(creditRows),
      };
      const saved = await upsertClientProfile(adminPassword, payload);
      await loadAdminData(adminPassword, saved.client_code);
      setNotice(`Profile saved for ${saved.client_code}.`);
      setActiveTab("clients");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? requestError?.message ?? "Unable to save profile.");
    } finally {
      setLoading(false);
    }
  }

  async function removeProfile(code = selectedClientCode) {
    if (!adminPassword || !code || code === NEW_PROFILE_ID) {
      return;
    }

    const profile = profiles.find((row) => row.client_code === code);
    const confirmationTarget = profile ? `${profile.client_name} (${profile.client_code})` : code;
    const confirmed = window.confirm(
      `Delete client profile ${confirmationTarget}? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      await deleteClientProfile(adminPassword, code);
      const remaining = profiles.filter((row) => row.client_code !== code);
      const nextCode = remaining[0]?.client_code ?? NEW_PROFILE_ID;
      await loadAdminData(adminPassword, nextCode);
      setNotice(`Client profile ${code} deleted.`);
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to delete client profile.");
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
          className={`topbar-icon-btn ${notificationsEnabled ? "active" : ""}`}
          onClick={handleNotificationsToggle}
          aria-label={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
          aria-pressed={notificationsEnabled}
          title={notificationsEnabled ? "Notifications on" : "Notifications off"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
            <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
            {!notificationsEnabled && <line x1="4" y1="4" x2="20" y2="20" />}
          </svg>
        </button>
        <button
          type="button"
          className="topbar-icon-btn"
          onClick={handleThemeToggle}
          aria-label={currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={currentTheme === "dark" ? "Light theme" : "Dark theme"}
        >
          {currentTheme === "dark" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <line x1="12" y1="2" x2="12" y2="4" />
              <line x1="12" y1="20" x2="12" y2="22" />
              <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
              <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
              <line x1="2" y1="12" x2="4" y2="12" />
              <line x1="20" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
              <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
            </svg>
          )}
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
          className={`admin-tab ${activeTab === "clients" ? "active" : ""}`}
          onClick={() => setActiveTab("clients")}
        >
          Client Directory
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
                <p className="muted-text">Only Turnaround Rules and Compliance Notes are optional.</p>

                <div className="admin-form-grid">
                  <label className="admin-field">
                    Client Name
                    <input
                      required
                      value={profileForm.client_name}
                      onChange={(event) => updateProfileField("client_name", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.client_name}
                    />
                  </label>
                  <label className="admin-field">
                    Client Code
                    <input
                      required
                      value={profileForm.client_code}
                      onChange={(event) => updateProfileField("client_code", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.client_code}
                    />
                  </label>
                  <label className="admin-field">
                    Subscription Tier
                    <input
                      required
                      value={profileForm.subscription_tier}
                      onChange={(event) => updateProfileField("subscription_tier", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.subscription_tier}
                    />
                  </label>
                  <label className="admin-field">
                    Default Approver
                    <input
                      required
                      value={profileForm.default_approver}
                      onChange={(event) => updateProfileField("default_approver", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.default_approver}
                    />
                  </label>
                  <label className="admin-field">
                    Preferred Tone
                    <input
                      required
                      value={profileForm.preferred_tone}
                      onChange={(event) => updateProfileField("preferred_tone", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.preferred_tone}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Brand Voice Rules
                    <textarea
                      required
                      rows="3"
                      value={profileForm.brand_voice_rules}
                      onChange={(event) => updateProfileField("brand_voice_rules", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.brand_voice_rules}
                    />
                  </label>
                  <label className="admin-field">
                    Words To Avoid (one per line)
                    <textarea
                      required
                      rows="4"
                      value={linesToText(profileForm.words_to_avoid)}
                      onChange={(event) =>
                        updateProfileField("words_to_avoid", parseLines(event.target.value))
                      }
                      placeholder={PROFILE_PLACEHOLDERS.words_to_avoid}
                    />
                  </label>
                  <label className="admin-field">
                    Common Audiences (one per line)
                    <textarea
                      required
                      rows="4"
                      value={linesToText(profileForm.common_audiences)}
                      onChange={(event) =>
                        updateProfileField("common_audiences", parseLines(event.target.value))
                      }
                      placeholder={PROFILE_PLACEHOLDERS.common_audiences}
                    />
                  </label>
                  <label className="admin-field">
                    Service List For This Client (optional)
                    <textarea
                      rows="4"
                      value={linesToText(profileForm.service_options)}
                      onChange={(event) =>
                        updateProfileField("service_options", parseLines(event.target.value))
                      }
                      placeholder={PROFILE_PLACEHOLDERS.service_options}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Required Disclaimers
                    <textarea
                      required
                      rows="3"
                      value={profileForm.required_disclaimers}
                      onChange={(event) => updateProfileField("required_disclaimers", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.required_disclaimers}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Turnaround Rules (optional)
                    <textarea
                      rows="3"
                      value={profileForm.turnaround_rules}
                      onChange={(event) => updateProfileField("turnaround_rules", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.turnaround_rules}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Compliance Notes (optional)
                    <textarea
                      rows="3"
                      value={profileForm.compliance_notes}
                      onChange={(event) => updateProfileField("compliance_notes", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.compliance_notes}
                    />
                  </label>
                </div>

                <div className="admin-row">
                  <button type="button" className="primary-btn" onClick={saveProfile} disabled={loading}>
                    {loading ? "Saving..." : "Save Client Profile"}
                  </button>
                  {selectedClientCode !== NEW_PROFILE_ID && (
                    <button
                      type="button"
                      className="ghost-btn danger-text"
                      onClick={() => removeProfile()}
                      disabled={loading}
                    >
                      Delete Client
                    </button>
                  )}
                </div>
              </article>

              <article className="panel credit-menu-panel">
                <div className="panel-header">
                  <h3>Credit Menu</h3>
                  <span className="tab-badge">{creditSummary.configuredItems}</span>
                </div>
                <p className="muted-text">
                  Define credits by service key for {selectedProfileLabel}. These values drive usage accounting and
                  approval flow.
                </p>
                <div className="credit-menu-summary">
                  <span className="summary-pill">{creditSummary.configuredItems} configured services</span>
                  <span className="summary-pill">{creditSummary.totalCredits} total credits</span>
                </div>
                <div className="credit-menu-scroll">
                  <div className="credit-menu-list">
                    {creditRows.map((row, index) => (
                      <div className="credit-menu-card" key={`${index}-${row.name}`}>
                        <div className="credit-menu-card-head">
                          <span className="credit-menu-index">Item {index + 1}</span>
                          <button
                            type="button"
                            className="ghost-btn danger-text"
                            onClick={() => removeCreditRow(index)}
                            disabled={loading}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="credit-menu-row">
                          <label className="admin-field">
                            Service Key
                            <input
                              value={row.name}
                              onChange={(event) => updateCreditRow(index, "name", event.target.value)}
                              placeholder={PROFILE_PLACEHOLDERS.credit_service_key}
                            />
                          </label>
                          <label className="admin-field">
                            Credits
                            <input
                              type="number"
                              min="0"
                              value={row.credits}
                              onChange={(event) => updateCreditRow(index, "credits", event.target.value)}
                              placeholder={PROFILE_PLACEHOLDERS.credit_value}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="admin-row credit-menu-actions">
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

        {activeTab === "clients" && (
          <div className="admin-section">
            <div className="client-directory-grid">
              <article className="panel client-directory-panel">
                <div className="panel-header">
                  <h3>Client Directory</h3>
                  <span className="tab-badge">{profiles.length}</span>
                </div>
                <p className="muted-text">Select a client to view the full profile in the details panel.</p>
                <div className="client-directory-toolbar">
                  <input
                    value={clientDirectoryQuery}
                    onChange={(event) => setClientDirectoryQuery(event.target.value)}
                    placeholder="Search by client name or code"
                    aria-label="Search clients"
                  />
                  {clientDirectoryQuery.trim() && (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setClientDirectoryQuery("")}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="muted-text">
                  Showing {filteredProfiles.length} of {profiles.length} client profiles.
                </p>
                <div className="client-directory-list">
                  {filteredProfiles.length === 0 && (
                    <p className="muted-text">
                      {profiles.length === 0 ? "No client profiles found yet." : "No clients match your search."}
                    </p>
                  )}
                  {filteredProfiles.map((profile) => (
                    <button
                      key={profile.client_code}
                      type="button"
                      className={`client-directory-item ${selectedClientCode === profile.client_code ? "active" : ""}`}
                      onClick={() => handleProfileSelect(profile.client_code)}
                      aria-pressed={selectedClientCode === profile.client_code}
                    >
                      <span className="client-directory-avatar">{clientInitials(profile.client_name)}</span>
                      <span className="client-directory-content">
                        <span className="client-directory-title-row">
                          <strong>{profile.client_name}</strong>
                          <span className="client-directory-code">{profile.client_code}</span>
                        </span>
                        <span className="client-directory-meta">
                          <span>{displayValue(profile.subscription_tier, "No tier")}</span>
                          <span>{displayValue(profile.preferred_tone, "No tone")}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel">
                {!selectedProfile && (
                  <p className="muted-text">Choose a client from the directory to preview the full profile.</p>
                )}
                {selectedProfile && (
                  <>
                    <div className="panel-header">
                      <h3>{selectedProfile.client_name}</h3>
                      <span className="table-badge">{selectedProfile.client_code}</span>
                    </div>
                    <p className="muted-text">
                      Review this profile and edit or delete it from here.
                    </p>
                    <div className="client-profile-preview">
                      <div className="client-profile-meta-grid">
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Client Name</p>
                          <p className="client-profile-meta-value">{displayValue(selectedProfile.client_name)}</p>
                        </div>
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Client Code</p>
                          <p className="client-profile-meta-value">{displayValue(selectedProfile.client_code)}</p>
                        </div>
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Preferred Tone</p>
                          <p className="client-profile-meta-value">{displayValue(selectedProfile.preferred_tone)}</p>
                        </div>
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Default Approver</p>
                          <p className="client-profile-meta-value">{displayValue(selectedProfile.default_approver)}</p>
                        </div>
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Subscription Tier</p>
                          <p className="client-profile-meta-value">{displayValue(selectedProfile.subscription_tier)}</p>
                        </div>
                        <div className="client-profile-meta-item">
                          <p className="client-profile-meta-label">Service Overrides</p>
                          <p className="client-profile-meta-value">
                            {selectedProfile.service_options?.length
                              ? `${selectedProfile.service_options.length} configured`
                              : "Using global services"}
                          </p>
                        </div>
                      </div>

                      <div className="client-profile-block">
                        <h4>Brand Voice Rules</h4>
                        <p>{displayValue(selectedProfile.brand_voice_rules)}</p>
                      </div>

                      <div className="client-profile-block">
                        <h4>Required Disclaimers</h4>
                        <p>{displayValue(selectedProfile.required_disclaimers)}</p>
                      </div>

                      <div className="client-profile-block">
                        <h4>Turnaround Rules (Optional)</h4>
                        <p>{displayValue(selectedProfile.turnaround_rules)}</p>
                      </div>

                      <div className="client-profile-block">
                        <h4>Compliance Notes (Optional)</h4>
                        <p>{displayValue(selectedProfile.compliance_notes)}</p>
                      </div>

                      <div className="client-profile-block">
                        <h4>Words To Avoid</h4>
                        <div className="client-tag-list">
                          {(selectedProfile.words_to_avoid ?? []).map((item, index) => (
                            <span key={`avoid-${item}-${index}`} className="client-tag">
                              {item}
                            </span>
                          ))}
                          {(selectedProfile.words_to_avoid ?? []).length === 0 && (
                            <span className="muted-text">None configured.</span>
                          )}
                        </div>
                      </div>

                      <div className="client-profile-block">
                        <h4>Common Audiences</h4>
                        <div className="client-tag-list">
                          {(selectedProfile.common_audiences ?? []).map((item, index) => (
                            <span key={`audience-${item}-${index}`} className="client-tag">
                              {item}
                            </span>
                          ))}
                          {(selectedProfile.common_audiences ?? []).length === 0 && (
                            <span className="muted-text">None configured.</span>
                          )}
                        </div>
                      </div>

                      <div className="client-profile-block">
                        <h4>Credit Menu</h4>
                        <div className="table-scroll">
                          <table className="credit-table-compact">
                            <thead>
                              <tr>
                                <th>Service Key</th>
                                <th>Credits</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(selectedProfile.credit_menu ?? {}).length === 0 && (
                                <tr>
                                  <td colSpan={2} className="empty-table-cell">No credit menu items found.</td>
                                </tr>
                              )}
                              {Object.entries(selectedProfile.credit_menu ?? {}).map(([serviceKey, credits]) => (
                                <tr key={serviceKey}>
                                  <td>{serviceKey}</td>
                                  <td>{credits}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                    <div className="admin-row">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          handleProfileSelect(selectedProfile.client_code);
                          setActiveTab("profiles");
                        }}
                        disabled={loading}
                      >
                        Edit Client
                      </button>
                      <button
                        type="button"
                        className="ghost-btn danger-text"
                        onClick={() => removeProfile(selectedProfile.client_code)}
                        disabled={loading}
                      >
                        Delete Client
                      </button>
                    </div>
                  </>
                )}
              </article>
            </div>
          </div>
        )}

        {activeTab === "services" && (
          <div className="admin-section">
            <article className="panel service-options-panel">
              <div className="panel-header">
                <h3>Global Service List Options</h3>
                <span className="tab-badge">{serviceOptionItems.length}</span>
              </div>
              <p className="muted-text">These options appear when a client profile does not override them.</p>
              <div className="service-options-layout">
                <section className="service-options-editor">
                  <div className="service-options-toolbar">
                    <span className="muted-text">Add one service option per line.</span>
                    <span className="summary-pill">{serviceOptionItems.length} total options</span>
                  </div>
                  <textarea
                    className="service-options-textarea"
                    rows="12"
                    value={serviceOptionsText}
                    onChange={(event) => setServiceOptionsText(event.target.value)}
                    placeholder="One service option per line"
                  />
                  <div className="service-options-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={saveServiceOptions}
                      disabled={loading}
                    >
                      {loading ? "Saving..." : "Save Service Options"}
                    </button>
                  </div>
                </section>
                <section className="service-options-preview-panel">
                  <h4>Preview</h4>
                  <p className="muted-text">These chips represent the options shown to users in intake forms.</p>
                  <div className="service-options-preview">
                    {serviceOptionItems.length === 0 && (
                      <span className="muted-text">No service options configured yet.</span>
                    )}
                    {serviceOptionItems.slice(0, 18).map((option, index) => (
                      <span key={`${option}-${index}`} className="service-option-chip">
                        {option}
                      </span>
                    ))}
                    {serviceOptionItems.length > 18 && (
                      <span className="service-option-chip">+{serviceOptionItems.length - 18} more</span>
                    )}
                  </div>
                </section>
              </div>
            </article>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="admin-section">
            <article className="panel logs-panel">
              <div className="logs-controls">
                <div className="panel-header">
                  <h3>Request Logs</h3>
                  <span className="tab-badge">{logs.length}</span>
                </div>
                <p className="muted-text">Audit history of requests submitted from the intake workspace.</p>
                <div className="logs-filters">
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
                  <input
                    value={logsQuery}
                    onChange={(event) => setLogsQuery(event.target.value)}
                    placeholder="Search by client, service, project, or Monday item"
                    aria-label="Search request logs"
                  />
                  {logsQuery.trim() && (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setLogsQuery("")}
                    >
                      Clear
                    </button>
                  )}
                  <button type="button" className="ghost-btn" onClick={refreshLogs} disabled={loading}>
                    Refresh Logs
                  </button>
                </div>
                <div className="logs-summary">
                  <span className="summary-pill">Visible: {filteredLogs.length}</span>
                  <span className="summary-pill">Loaded: {logs.length}</span>
                  <span className="summary-pill">Limit: {logLimit}</span>
                </div>
              </div>
              <div className="table-scroll">
                <table className="logs-table">
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
                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty-table-cell">
                          {logs.length === 0 ? "No request logs found." : "No logs match your search."}
                        </td>
                      </tr>
                    )}
                    {filteredLogs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
                        </td>
                        <td>
                          <div className="logs-client">
                            <span className="table-badge">{log.client_code}</span>
                            <span>{displayValue(log.client_name, "Unknown client")}</span>
                          </div>
                        </td>
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
