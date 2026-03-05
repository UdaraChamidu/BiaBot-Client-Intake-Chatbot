import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import {
  deleteAdminNotification,
  deleteClientProfile,
  getAdminNotifications,
  getClientProfiles,
  getRequestLogs,
  getServiceOptions,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  updateServiceOptions,
  upsertClientProfile,
  verifyAdminPassword,
} from "../services/adminService";
import { getStoredTheme, toggleTheme } from "../utils/theme";

const NEW_PROFILE_ID = "__new__";
const ADMIN_SESSION_PASSWORD_KEY = "admin_session_password";
const ADMIN_PERSIST_PASSWORD_KEY = "admin_persist_password";
const ADMIN_NOTIFICATIONS_AVAILABLE_KEY = "admin_notifications_api_available";

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

function toErrorText(requestError, fallback) {
  const detail = requestError?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        const location = Array.isArray(item?.loc) ? item.loc.join(".") : "request";
        const message = String(item?.msg ?? "").trim();
        return message ? `${location}: ${message}` : "";
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(" | ");
    }
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }
  const message = String(requestError?.message ?? "").trim();
  return message || fallback;
}

function isLegacyStrictProfile422(requestError) {
  const detail = requestError?.response?.data?.detail;
  if (!Array.isArray(detail)) {
    return false;
  }
  const fields = new Set(
    detail
      .map((item) => (Array.isArray(item?.loc) ? String(item.loc[1] ?? "") : ""))
      .filter(Boolean)
  );
  return (
    fields.has("brand_voice_rules") ||
    fields.has("words_to_avoid") ||
    fields.has("required_disclaimers") ||
    fields.has("preferred_tone") ||
    fields.has("common_audiences") ||
    fields.has("default_approver") ||
    fields.has("subscription_tier") ||
    fields.has("credit_menu")
  );
}

function withLegacyRequiredDefaults(payload) {
  const normalized = { ...payload };
  if (!String(normalized.brand_voice_rules ?? "").trim()) {
    normalized.brand_voice_rules = "Not provided";
  }
  if (!Array.isArray(normalized.words_to_avoid) || normalized.words_to_avoid.length === 0) {
    normalized.words_to_avoid = ["not specified"];
  }
  if (!String(normalized.required_disclaimers ?? "").trim()) {
    normalized.required_disclaimers = "Not provided";
  }
  if (!String(normalized.preferred_tone ?? "").trim()) {
    normalized.preferred_tone = "Not specified";
  }
  if (!Array.isArray(normalized.common_audiences) || normalized.common_audiences.length === 0) {
    normalized.common_audiences = ["general audience"];
  }
  if (!String(normalized.default_approver ?? "").trim()) {
    normalized.default_approver = "Not assigned";
  }
  if (!String(normalized.subscription_tier ?? "").trim()) {
    normalized.subscription_tier = "Not specified";
  }
  if (
    !normalized.credit_menu ||
    typeof normalized.credit_menu !== "object" ||
    Object.keys(normalized.credit_menu).length === 0
  ) {
    normalized.credit_menu = { general: 0 };
  }
  return normalized;
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

function toMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : null;
}

function formatRelativeTime(value) {
  const timestamp = toMs(value);
  if (!timestamp) {
    return "Unknown time";
  }
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return "Just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatSubmissionFieldLabel(fieldKey) {
  const raw = String(fieldKey ?? "").trim();
  if (!raw) {
    return "Field";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSubmissionAnswerValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    return parts.join(", ");
  }
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .map(([key, nested]) => {
        const nestedText = formatSubmissionAnswerValue(nested);
        if (!nestedText) {
          return "";
        }
        return `${formatSubmissionFieldLabel(key)}: ${nestedText}`;
      })
      .filter(Boolean);
    return parts.join(" | ");
  }
  return String(value).trim();
}

function buildSubmissionAnswerRows(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const rows = [];
  const seen = new Set();
  const pushRow = (key, label, value) => {
    const rowKey = String(key ?? "").trim().toLowerCase();
    if (!rowKey || seen.has(rowKey)) {
      return;
    }
    const text = formatSubmissionAnswerValue(value);
    if (!text) {
      return;
    }
    seen.add(rowKey);
    rows.push({
      id: rowKey,
      label: label || formatSubmissionFieldLabel(key),
      value: text,
    });
  };

  pushRow("service_type", "Service Type", payload.service_type);

  const capturedAnswers = payload.captured_answers;
  if (capturedAnswers && typeof capturedAnswers === "object" && !Array.isArray(capturedAnswers)) {
    for (const [key, value] of Object.entries(capturedAnswers)) {
      pushRow(key, formatSubmissionFieldLabel(key), value);
    }
    return rows;
  }

  const orderedKeys = [
    ["project_title", "Project Title"],
    ["goal", "Goal"],
    ["target_audience", "Target Audience"],
    ["primary_cta", "Primary CTA"],
    ["time_sensitivity", "Time Sensitivity"],
    ["due_date", "Due Date"],
    ["approver", "Approver"],
    ["required_elements", "Required Elements"],
    ["references", "References / Links"],
    ["uploaded_files", "Uploaded Files"],
    ["notes", "Notes"],
  ];
  for (const [key, label] of orderedKeys) {
    pushRow(key, label, payload[key]);
  }

  const branchAnswers = payload.branch_answers;
  if (branchAnswers && typeof branchAnswers === "object" && !Array.isArray(branchAnswers)) {
    for (const [key, value] of Object.entries(branchAnswers)) {
      pushRow(key, formatSubmissionFieldLabel(key), value);
    }
  }

  return rows;
}

function readBooleanPref(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return fallback;
}

function readNumberPref(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function setStoredAdminPassword(password) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(ADMIN_SESSION_PASSWORD_KEY, password);
  window.localStorage.setItem(ADMIN_PERSIST_PASSWORD_KEY, password);
}

function getStoredAdminPassword() {
  if (typeof window === "undefined") {
    return "";
  }
  const fromSession = String(
    window.sessionStorage.getItem(ADMIN_SESSION_PASSWORD_KEY) ?? ""
  ).trim();
  if (fromSession) {
    return fromSession;
  }
  const fromLocal = String(
    window.localStorage.getItem(ADMIN_PERSIST_PASSWORD_KEY) ?? ""
  ).trim();
  return fromLocal;
}

function clearStoredAdminPassword() {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(ADMIN_SESSION_PASSWORD_KEY);
  window.localStorage.removeItem(ADMIN_PERSIST_PASSWORD_KEY);
}

export default function AdminPage() {
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
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

  const [activeTab, setActiveTab] = useState("dashboard");
  const [notifications, setNotifications] = useState([]);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [notificationsApiAvailable, setNotificationsApiAvailable] = useState(() =>
    readBooleanPref(ADMIN_NOTIFICATIONS_AVAILABLE_KEY, true)
  );
  const [currentTheme, setCurrentTheme] = useState(getStoredTheme());
  const [dashboardProfiles, setDashboardProfiles] = useState([]);
  const [dashboardLogs, setDashboardLogs] = useState([]);
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() =>
    readBooleanPref("admin_auto_refresh_enabled", true)
  );
  const [dashboardPollSeconds, setDashboardPollSeconds] = useState(() =>
    readNumberPref("admin_dashboard_poll_seconds", 10)
  );
  const [notificationPollSeconds, setNotificationPollSeconds] = useState(() =>
    readNumberPref("admin_notification_poll_seconds", 8)
  );
  const [settingsLogLimit, setSettingsLogLimit] = useState("100");
  const notificationPopoverRef = useRef(null);
  const notificationButtonRef = useRef(null);

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

  const latestAdminLogs = useMemo(() => {
    const deduped = new Map();
    for (const log of [...dashboardLogs, ...logs]) {
      const id = String(log?.id ?? "").trim();
      if (!id || deduped.has(id)) {
        continue;
      }
      deduped.set(id, log);
    }
    return [...deduped.values()].sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0));
  }, [dashboardLogs, logs]);

  const selectedClientSubmissions = useMemo(() => {
    const selectedCode = String(selectedProfile?.client_code ?? "").trim().toUpperCase();
    if (!selectedCode) {
      return [];
    }
    return latestAdminLogs.filter(
      (log) => String(log.client_code ?? "").trim().toUpperCase() === selectedCode
    );
  }, [latestAdminLogs, selectedProfile?.client_code]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications]
  );
  const toastMessages = useMemo(() => {
    const items = [];
    if (error) {
      items.push({ id: "error", kind: "error", text: error });
    }
    if (notice) {
      items.push({ id: "notice", kind: "success", text: notice });
    }
    return items;
  }, [error, notice]);

  const dashboardStats = useMemo(() => {
    const metricProfiles = dashboardProfiles.length ? dashboardProfiles : profiles;
    const metricLogs = dashboardLogs.length ? dashboardLogs : logs;
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let recentRequests7d = 0;
    let mondayLinked = 0;
    const activeClients30d = new Set();
    const serviceCounts = new Map();
    const tierCounts = new Map();

    for (const profile of metricProfiles) {
      const tier = String(profile.subscription_tier || "Unspecified").trim() || "Unspecified";
      tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
    }

    for (const log of metricLogs) {
      const createdAtMs = toMs(log.created_at);
      if (createdAtMs && createdAtMs >= sevenDaysAgo) {
        recentRequests7d += 1;
      }
      if (createdAtMs && createdAtMs >= thirtyDaysAgo && String(log.client_code ?? "").trim()) {
        activeClients30d.add(String(log.client_code).trim().toUpperCase());
      }
      if (String(log.monday_item_id ?? "").trim()) {
        mondayLinked += 1;
      }
      const service = String(log.service_type || "Unspecified").trim() || "Unspecified";
      serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
    }

    const topServices = [...serviceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const tierDistribution = [...tierCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    const completionFields = [
      (profile) => Boolean(String(profile.brand_voice_rules ?? "").trim()),
      (profile) => Boolean(String(profile.required_disclaimers ?? "").trim()),
      (profile) => Boolean(String(profile.preferred_tone ?? "").trim()),
      (profile) => Boolean(String(profile.default_approver ?? "").trim()),
      (profile) => Boolean(String(profile.subscription_tier ?? "").trim()),
      (profile) => (profile.words_to_avoid ?? []).length > 0,
      (profile) => (profile.common_audiences ?? []).length > 0,
      (profile) => Object.keys(profile.credit_menu ?? {}).length > 0,
    ];

    let completionPercent = 0;
    if (profiles.length > 0) {
      let achieved = 0;
      for (const profile of profiles) {
        for (const isFilled of completionFields) {
          if (isFilled(profile)) {
            achieved += 1;
          }
        }
      }
      completionPercent = Math.round((achieved / (profiles.length * completionFields.length)) * 100);
    }

    return {
      totalClients: metricProfiles.length,
      totalRequests: metricLogs.length,
      recentRequests7d,
      activeClients30d: activeClients30d.size,
      mondayLinked,
      mondayCoverage: metricLogs.length ? Math.round((mondayLinked / metricLogs.length) * 100) : 0,
      profileCompleteness: completionPercent,
      topServices,
      tierDistribution,
      latestLogs: metricLogs.slice(0, 6),
    };
  }, [profiles, logs, dashboardProfiles, dashboardLogs]);

  function handleThemeToggle() {
    const next = toggleTheme();
    setCurrentTheme(next);
  }

  async function toggleNotificationPanel() {
    if (!notificationsApiAvailable) {
      const restored = await loadNotifications(adminPassword, 100, true);
      if (!restored) {
        setNotice("Notifications are unavailable. Apply latest DB schema and restart backend.");
        return;
      }
    }
    setIsNotificationPanelOpen((prev) => !prev);
  }

  function saveAdminSetting(key, value) {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(key, value);
  }

  function setNotificationsAvailability(nextAvailable) {
    setNotificationsApiAvailable(nextAvailable);
    saveAdminSetting(ADMIN_NOTIFICATIONS_AVAILABLE_KEY, nextAvailable ? "1" : "0");
  }

  async function loadNotifications(password, limit = 100, force = false) {
    if (!password || (!notificationsApiAvailable && !force)) {
      return false;
    }
    try {
      const rows = await getAdminNotifications(password, limit);
      setNotifications(rows);
      setNotificationsAvailability(true);
      return true;
    } catch (requestError) {
      if (Number(requestError?.response?.status) === 404) {
        setNotificationsAvailability(false);
        setNotifications([]);
        setIsNotificationPanelOpen(false);
        setNotice("Notifications are unavailable. Apply latest DB schema and restart backend.");
        return false;
      }
      throw requestError;
    }
  }

  async function handleMarkNotificationRead(notificationId) {
    if (!adminPassword || !notificationId || !notificationsApiAvailable) {
      return;
    }
    try {
      const updated = await markAdminNotificationRead(adminPassword, notificationId);
      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId ? updated : item))
      );
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to mark notification as read."));
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!adminPassword || !notificationsApiAvailable) {
      return;
    }
    try {
      await markAllAdminNotificationsRead(adminPassword);
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to mark all notifications as read."));
    }
  }

  async function handleDeleteNotification(notificationId) {
    if (!adminPassword || !notificationId || !notificationsApiAvailable) {
      return;
    }
    try {
      await deleteAdminNotification(adminPassword, notificationId);
      setNotifications((prev) => prev.filter((item) => item.id !== notificationId));
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to delete notification."));
    }
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

  async function refreshDashboardSnapshot(password) {
    if (!password) {
      return;
    }
    const [nextProfilesRaw, nextLogs] = await Promise.all([
      getClientProfiles(password),
      getRequestLogs(password, 500),
    ]);
    setDashboardProfiles(sortProfiles(nextProfilesRaw));
    setDashboardLogs(nextLogs);
    setDashboardUpdatedAt(new Date().toISOString());
  }

  async function applySettingsChanges() {
    const parsedLimit = Number.parseInt(settingsLogLimit, 10);
    const nextLimit = Number.isInteger(parsedLimit) ? parsedLimit : logLimit;
    setLogLimit(nextLimit);
    saveAdminSetting("admin_auto_refresh_enabled", autoRefreshEnabled ? "1" : "0");
    saveAdminSetting("admin_dashboard_poll_seconds", String(dashboardPollSeconds));
    saveAdminSetting("admin_notification_poll_seconds", String(notificationPollSeconds));
    saveAdminSetting("admin_default_log_limit", String(nextLimit));
    if (adminPassword) {
      await loadAdminData(adminPassword);
      const nextLogs = await getRequestLogs(adminPassword, nextLimit);
      setLogs(nextLogs);
      await refreshDashboardSnapshot(adminPassword);
      if (notificationsApiAvailable) {
        await loadNotifications(adminPassword, 100);
      }
    }
    setNotice("Settings updated.");
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
      setStoredAdminPassword(password);
      setActiveTab("dashboard");
      const savedDefaultLimit = readNumberPref("admin_default_log_limit", 100);
      setSettingsLogLimit(String(savedDefaultLimit));
      setLogLimit(savedDefaultLimit);
      await loadAdminData(password);
      await refreshDashboardSnapshot(password);
      if (notificationsApiAvailable) {
        await loadNotifications(password, 100);
      }
      setNotice("Admin access granted.");
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to authenticate admin password."));
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
      await refreshDashboardSnapshot(adminPassword);
      if (notificationsApiAvailable) {
        await loadNotifications(adminPassword, 100);
      }
      setNotice("Admin data refreshed.");
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to refresh admin data."));
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
    ];

    for (const [field, label] of requiredTextFields) {
      const value = String(profileForm[field] ?? "").trim();
      if (!value) {
        return `${label} is required.`;
      }
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

    if (!normalizedCode || !normalizedName) {
      setError("Client code and client name are required.");
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
      let saved;
      try {
        saved = await upsertClientProfile(adminPassword, payload);
      } catch (requestError) {
        if (!isLegacyStrictProfile422(requestError)) {
          throw requestError;
        }
        saved = await upsertClientProfile(adminPassword, withLegacyRequiredDefaults(payload));
      }
      setActiveTab("clients");
      setSelectedClientCode(saved.client_code);
      setNotice(`Profile saved for ${saved.client_code}.`);
      try {
        await loadAdminData(adminPassword, saved.client_code);
      } catch {
        const normalizedSaved = normalizeProfile(saved);
        setProfiles((prev) => {
          const withoutCurrent = prev.filter((row) => row.client_code !== normalizedSaved.client_code);
          return sortProfiles([...withoutCurrent, normalizedSaved]);
        });
      }
    } catch (requestError) {
      setError(toErrorText(requestError, "Unable to save profile."));
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
      setError(toErrorText(requestError, "Unable to delete client profile."));
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
      setError(toErrorText(requestError, "Unable to save service options."));
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
      setError(toErrorText(requestError, "Unable to load request logs."));
    } finally {
      setLoading(false);
    }
  }

  function logoutAdmin() {
    clearStoredAdminPassword();
    setAdminPassword("");
    setAdminPasswordInput("");
    setIsAuthenticated(false);
    setProfiles([]);
    setLogs([]);
    setSelectedClientCode(NEW_PROFILE_ID);
    setActiveTab("dashboard");
    hydrateProfileForm(EMPTY_PROFILE_TEMPLATE);
    setDashboardProfiles([]);
    setDashboardLogs([]);
    setDashboardUpdatedAt("");
    setSettingsLogLimit("100");
    setNotifications([]);
    setIsNotificationPanelOpen(false);
    setError("");
    setNotice("");
  }

  useEffect(() => {
    if (!isAuthenticated || !adminPassword) {
      return;
    }
    if (!autoRefreshEnabled) {
      return;
    }

    let cancelled = false;
    const pollMs = activeTab === "dashboard" ? dashboardPollSeconds * 1000 : 30000;

    const run = async () => {
      try {
        await refreshDashboardSnapshot(adminPassword);
      } catch {
        if (!cancelled && activeTab === "dashboard") {
          setError("Dashboard refresh failed. Data may be stale.");
        }
      }
    };

    run();
    const timer = setInterval(run, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, adminPassword, activeTab, autoRefreshEnabled, dashboardPollSeconds]);

  useEffect(() => {
    if (!isAuthenticated || !adminPassword || !notificationsApiAvailable) {
      return;
    }
    if (!autoRefreshEnabled) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        await loadNotifications(adminPassword, 100);
      } catch {
        // Non-blocking; polling will retry.
      }
    };
    run();
    const timer = setInterval(run, notificationPollSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, adminPassword, autoRefreshEnabled, notificationPollSeconds, notificationsApiAvailable]);

  useEffect(() => {
    if (!isNotificationPanelOpen) {
      return;
    }
    const handleOutsideClick = (event) => {
      const panelEl = notificationPopoverRef.current;
      const buttonEl = notificationButtonRef.current;
      const target = event.target;
      if (panelEl && panelEl.contains(target)) {
        return;
      }
      if (buttonEl && buttonEl.contains(target)) {
        return;
      }
      setIsNotificationPanelOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isNotificationPanelOpen]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(""), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(""), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;

    async function restoreAdminSession() {
      try {
        if (typeof window === "undefined") {
          return;
        }
        const savedPassword = getStoredAdminPassword();
        if (!savedPassword) {
          return;
        }

        try {
          await verifyAdminPassword(savedPassword);
        } catch {
          clearStoredAdminPassword();
          return;
        }
        if (cancelled) {
          return;
        }

        setAdminPassword(savedPassword);
        setAdminPasswordInput("");
        setIsAuthenticated(true);
        setStoredAdminPassword(savedPassword);
        setActiveTab("dashboard");

        const savedDefaultLimit = readNumberPref("admin_default_log_limit", 100);
        setSettingsLogLimit(String(savedDefaultLimit));
        setLogLimit(savedDefaultLimit);

        const restoreTasks = [loadAdminData(savedPassword), refreshDashboardSnapshot(savedPassword)];
        if (notificationsApiAvailable) {
          restoreTasks.push(loadNotifications(savedPassword, 100));
        }
        await Promise.allSettled(restoreTasks);
        if (!cancelled) {
          setNotice("Admin session restored.");
        }
      } catch {
        // Keep session when non-auth restore steps fail; retry paths can recover.
      } finally {
        if (!cancelled) {
          setIsSessionChecked(true);
        }
      }
    }

    restoreAdminSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        </nav>
        <div className="notification-popover-wrap">
          <button
            ref={notificationButtonRef}
            type="button"
            className={`topbar-icon-btn ${isNotificationPanelOpen ? "active" : ""}`}
            onClick={toggleNotificationPanel}
            aria-label={isNotificationPanelOpen ? "Close notifications" : "Open notifications"}
            aria-pressed={isNotificationPanelOpen}
            title={notificationsApiAvailable ? "Notifications" : "Notifications unavailable"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
              <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
            </svg>
            {unreadNotificationCount > 0 && (
              <span className="notification-badge">
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </span>
            )}
          </button>

          {isNotificationPanelOpen && (
            <section ref={notificationPopoverRef} className="notification-popover panel">
              <div className="panel-header">
                <h3>Notifications</h3>
                <span className="tab-badge">{unreadNotificationCount} unread</span>
              </div>
              <div className="notification-toolbar">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={handleMarkAllNotificationsRead}
                  disabled={notifications.length === 0}
                >
                  Mark All Read
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => loadNotifications(adminPassword, 100, true)}
                  disabled={!adminPassword}
                >
                  Refresh
                </button>
              </div>
              <div className="notification-list">
                {notifications.length === 0 && (
                  <p className="muted-text">No notifications yet.</p>
                )}
                {notifications.map((item) => (
                  <article
                    key={item.id}
                    className={`notification-item ${item.is_read ? "read" : "unread"}`}
                  >
                    <div className="notification-head">
                      <strong>{item.title}</strong>
                      <span className="summary-pill">{formatRelativeTime(item.created_at)}</span>
                    </div>
                    <p>{item.message}</p>
                    <div className="notification-meta">
                      <span className="table-badge">{item.client_code}</span>
                      <span>{displayValue(item.client_name, "Unknown client")}</span>
                    </div>
                    <div className="notification-actions">
                      {!item.is_read && (
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => handleMarkNotificationRead(item.id)}
                        >
                          Mark Read
                        </button>
                      )}
                      <button
                        type="button"
                        className="ghost-btn danger-text"
                        onClick={() => handleDeleteNotification(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
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
          </>
        )}
      </div>
    </div>
  );

  if (!isSessionChecked) {
    return (
      <section className="admin-login-screen">
        <div className="admin-login-stack">
          <div className="admin-login-card">
            <div className="admin-login-header">
              <div className="admin-login-icon">B</div>
              <h2>Loading Admin Console</h2>
            </div>
            <p className="admin-login-copy">Checking saved admin session...</p>
          </div>
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="admin-login-screen">
        <div className="admin-login-stack">
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
      <div className="admin-header-shell">
        {adminTopbar}

        <nav className="admin-tabs">
          <button
            type="button"
            className={`admin-tab ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
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
          <button
            type="button"
            className={`admin-tab ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </nav>
      </div>

      <div className="admin-tab-content">
        {activeTab === "dashboard" && (
          <div className="admin-section">
            <div className="dashboard-kpi-grid">
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Total Clients</p>
                <p className="dashboard-kpi-value">{dashboardStats.totalClients}</p>
                <p className="muted-text">Profiles in directory</p>
              </article>
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Recent Requests</p>
                <p className="dashboard-kpi-value">{dashboardStats.totalRequests}</p>
                <p className="muted-text">Live snapshot (last 500)</p>
              </article>
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Requests (7 Days)</p>
                <p className="dashboard-kpi-value">{dashboardStats.recentRequests7d}</p>
                <p className="muted-text">Recent workload trend</p>
              </article>
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Active Clients (30 Days)</p>
                <p className="dashboard-kpi-value">{dashboardStats.activeClients30d}</p>
                <p className="muted-text">Clients with recent requests</p>
              </article>
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Monday Coverage</p>
                <p className="dashboard-kpi-value">{dashboardStats.mondayCoverage}%</p>
                <p className="muted-text">{dashboardStats.mondayLinked} requests linked</p>
              </article>
              <article className="panel dashboard-kpi-card">
                <p className="dashboard-kpi-label">Profile Completeness</p>
                <p className="dashboard-kpi-value">{dashboardStats.profileCompleteness}%</p>
                <p className="muted-text">Optional fields utilization</p>
              </article>
            </div>

            <div className="dashboard-grid">
              <article className="panel">
                <div className="panel-header">
                  <h3>Top Services</h3>
                  <span className="tab-badge">{dashboardStats.topServices.length}</span>
                </div>
                <p className="muted-text">
                  {dashboardUpdatedAt
                    ? `Last updated: ${new Date(dashboardUpdatedAt).toLocaleTimeString()}`
                    : "Waiting for live data..."}
                </p>
                <div className="dashboard-list">
                  {dashboardStats.topServices.length === 0 && (
                    <p className="muted-text">No service activity yet.</p>
                  )}
                  {dashboardStats.topServices.map((item) => (
                    <div key={item.name} className="dashboard-list-row">
                      <span>{item.name}</span>
                      <span className="summary-pill">{item.count}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Client Tiers</h3>
                  <span className="tab-badge">{dashboardStats.tierDistribution.length}</span>
                </div>
                <div className="dashboard-list">
                  {dashboardStats.tierDistribution.length === 0 && (
                    <p className="muted-text">No client tiers recorded yet.</p>
                  )}
                  {dashboardStats.tierDistribution.map((item) => (
                    <div key={item.name} className="dashboard-list-row">
                      <span>{item.name}</span>
                      <span className="summary-pill">{item.count}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel dashboard-recent-panel">
                <div className="panel-header">
                  <h3>Recent Activity</h3>
                  <span className="tab-badge">{dashboardStats.latestLogs.length}</span>
                </div>
                <div className="dashboard-list">
                  {dashboardStats.latestLogs.length === 0 && (
                    <p className="muted-text">No recent submissions.</p>
                  )}
                  {dashboardStats.latestLogs.map((log) => (
                    <div key={log.id} className="dashboard-activity-row">
                      <div>
                        <p className="dashboard-activity-title">{displayValue(log.project_title, "Untitled request")}</p>
                        <p className="muted-text">
                          {displayValue(log.client_name, log.client_code)} • {displayValue(log.service_type, "Unknown service")}
                        </p>
                      </div>
                      <time className="dashboard-time" dateTime={log.created_at}>
                        {toMs(log.created_at) ? new Date(log.created_at).toLocaleString() : "Unknown time"}
                      </time>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        )}

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
                <p className="muted-text">Only Client Name and Client Code are required. All other fields are optional.</p>

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
                      value={profileForm.subscription_tier}
                      onChange={(event) => updateProfileField("subscription_tier", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.subscription_tier}
                    />
                  </label>
                  <label className="admin-field">
                    Default Approver
                    <input
                      value={profileForm.default_approver}
                      onChange={(event) => updateProfileField("default_approver", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.default_approver}
                    />
                  </label>
                  <label className="admin-field">
                    Preferred Tone
                    <input
                      value={profileForm.preferred_tone}
                      onChange={(event) => updateProfileField("preferred_tone", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.preferred_tone}
                    />
                  </label>
                  <label className="admin-field admin-field-wide">
                    Brand Voice Rules
                    <textarea
                      rows="3"
                      value={profileForm.brand_voice_rules}
                      onChange={(event) => updateProfileField("brand_voice_rules", event.target.value)}
                      placeholder={PROFILE_PLACEHOLDERS.brand_voice_rules}
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
                      placeholder={PROFILE_PLACEHOLDERS.words_to_avoid}
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

                      <div className="client-profile-block">
                        <div className="client-submission-header">
                          <h4>Submitted Intake Details</h4>
                          <span className="summary-pill">{selectedClientSubmissions.length}</span>
                        </div>
                        <p className="muted-text">
                          Submission data is loaded from request logs and includes chatbot answers and branch fields.
                        </p>
                        {selectedClientSubmissions.length === 0 && (
                          <p className="muted-text">No submitted intake requests found for this client yet.</p>
                        )}
                        {selectedClientSubmissions.length > 0 && (
                          <div className="client-submission-list">
                            {selectedClientSubmissions.map((submission, index) => {
                              const answerRows = buildSubmissionAnswerRows(submission.payload);
                              return (
                                <details
                                  key={submission.id}
                                  className="client-submission-item"
                                  open={index === 0}
                                >
                                  <summary>
                                    <span>
                                      {displayValue(submission.project_title, "Untitled request")} •{" "}
                                      {displayValue(submission.service_type, "Unknown service")}
                                    </span>
                                    <span className="muted-text">
                                      {toMs(submission.created_at)
                                        ? new Date(submission.created_at).toLocaleString()
                                        : "Unknown time"}
                                    </span>
                                  </summary>
                                  <p className="muted-text">
                                    Monday Item: {displayValue(submission.monday_item_id, "-")}
                                  </p>
                                  <div className="table-scroll">
                                    <table className="credit-table-compact client-submission-table">
                                      <thead>
                                        <tr>
                                          <th>Question / Field</th>
                                          <th>Answer</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {answerRows.length === 0 && (
                                          <tr>
                                            <td colSpan={2} className="empty-table-cell">
                                              No captured answers found for this submission.
                                            </td>
                                          </tr>
                                        )}
                                        {answerRows.map((row) => (
                                          <tr key={`${submission.id}-${row.id}`}>
                                            <td>{row.label}</td>
                                            <td>{row.value}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  <p className="client-submission-summary">
                                    <strong>Summary:</strong> {displayValue(submission.summary)}
                                  </p>
                                </details>
                              );
                            })}
                          </div>
                        )}
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

        {activeTab === "settings" && (
          <div className="admin-section">
            <article className="panel settings-panel">
              <div className="panel-header">
                <h3>Admin Settings</h3>
                <span className="tab-badge">Config</span>
              </div>
              <p className="muted-text">
                Configure console behavior and admin controls. These settings apply to your browser session.
              </p>

              <div className="settings-grid">
                <label className="admin-field">
                  Auto Refresh
                  <select
                    value={autoRefreshEnabled ? "on" : "off"}
                    onChange={(event) => setAutoRefreshEnabled(event.target.value === "on")}
                  >
                    <option value="on">Enabled</option>
                    <option value="off">Disabled</option>
                  </select>
                </label>

                <label className="admin-field">
                  Dashboard Refresh Interval
                  <select
                    value={String(dashboardPollSeconds)}
                    onChange={(event) => setDashboardPollSeconds(Number.parseInt(event.target.value, 10))}
                  >
                    <option value="5">5 seconds</option>
                    <option value="10">10 seconds</option>
                    <option value="15">15 seconds</option>
                    <option value="30">30 seconds</option>
                  </select>
                </label>

                <label className="admin-field">
                  Notification Refresh Interval
                  <select
                    value={String(notificationPollSeconds)}
                    onChange={(event) => setNotificationPollSeconds(Number.parseInt(event.target.value, 10))}
                  >
                    <option value="5">5 seconds</option>
                    <option value="8">8 seconds</option>
                    <option value="10">10 seconds</option>
                    <option value="15">15 seconds</option>
                  </select>
                </label>

                <label className="admin-field">
                  Default Request Log Limit
                  <select
                    value={settingsLogLimit}
                    onChange={(event) => setSettingsLogLimit(event.target.value)}
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                  </select>
                </label>
              </div>

              <div className="settings-actions">
                <button type="button" className="primary-btn" onClick={applySettingsChanges} disabled={loading}>
                  Save Settings
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => loadNotifications(adminPassword, 100, true)}
                  disabled={!adminPassword}
                >
                  Refresh Notifications
                </button>
                <button type="button" className="ghost-btn" onClick={refreshAdminData} disabled={loading}>
                  Refresh All Data
                </button>
              </div>

              <div className="settings-signout">
                <p className="muted-text">Account</p>
                <button type="button" className="ghost-btn danger-text" onClick={logoutAdmin} disabled={loading}>
                  Sign Out
                </button>
              </div>
            </article>
          </div>
        )}
      </div>
      {toastMessages.length > 0 && (
        <div className="admin-toast-stack" role="status" aria-live="polite">
          {toastMessages.map((toast) => (
            <article
              key={toast.id}
              className={`admin-toast ${toast.kind === "error" ? "error" : "success"}`}
            >
              {toast.text}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
