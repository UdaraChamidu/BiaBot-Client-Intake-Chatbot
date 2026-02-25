import { useState } from "react";

import {
  getClientProfiles,
  getRequestLogs,
  getServiceOptions,
  updateServiceOptions,
  upsertClientProfile,
} from "../services/adminService";

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

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [serviceOptionsText, setServiceOptionsText] = useState("");
  const [profileEditor, setProfileEditor] = useState(
    JSON.stringify(EMPTY_PROFILE_TEMPLATE, null, 2)
  );

  async function loadAdminData() {
    setLoading(true);
    setError("");
    try {
      const [nextProfiles, nextOptions, nextLogs] = await Promise.all([
        getClientProfiles(adminKey),
        getServiceOptions(adminKey),
        getRequestLogs(adminKey),
      ]);

      setProfiles(nextProfiles);
      setServiceOptionsText(nextOptions.join("\n"));
      setLogs(nextLogs);
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to load admin data.");
    } finally {
      setLoading(false);
    }
  }

  async function saveServiceOptions() {
    setLoading(true);
    setError("");
    try {
      const options = serviceOptionsText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const updated = await updateServiceOptions(adminKey, options);
      setServiceOptionsText(updated.join("\n"));
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Unable to save service options.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setLoading(true);
    setError("");
    try {
      const parsed = JSON.parse(profileEditor);
      const saved = await upsertClientProfile(adminKey, parsed);
      setProfileEditor(JSON.stringify(saved, null, 2));
      await loadAdminData();
    } catch (requestError) {
      if (requestError instanceof SyntaxError) {
        setError("Profile JSON is invalid.");
      } else {
        const detail = requestError?.response?.data?.detail;
        setError(detail ?? "Unable to save profile.");
      }
      setLoading(false);
    }
  }

  return (
    <section className="card admin-page">
      <div className="intro-row">
        <div>
          <h2>Admin Console</h2>
          <p>Manage client profiles, service options, and request logs.</p>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <section className="admin-auth">
        <label htmlFor="admin-key">Admin API key</label>
        <input
          id="admin-key"
          value={adminKey}
          onChange={(event) => setAdminKey(event.target.value)}
          placeholder="Enter admin key"
        />
        <button type="button" className="primary-btn" onClick={loadAdminData} disabled={loading}>
          {loading ? "Loading..." : "Load Admin Data"}
        </button>
      </section>

      <section className="admin-grid">
        <article className="panel">
          <h3>Service Options</h3>
          <textarea
            rows="10"
            value={serviceOptionsText}
            onChange={(event) => setServiceOptionsText(event.target.value)}
          />
          <button type="button" className="primary-btn" onClick={saveServiceOptions} disabled={loading}>
            Save Options
          </button>
        </article>

        <article className="panel">
          <h3>Client Profile Editor (JSON)</h3>
          <textarea
            rows="14"
            value={profileEditor}
            onChange={(event) => setProfileEditor(event.target.value)}
          />
          <button type="button" className="primary-btn" onClick={saveProfile} disabled={loading}>
            Upsert Profile
          </button>
        </article>
      </section>

      <section className="panel">
        <h3>Client Profiles</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Code</th>
                <th>Tier</th>
                <th>Approver</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.client_code}>
                  <td>{profile.client_name}</td>
                  <td>{profile.client_code}</td>
                  <td>{profile.subscription_tier ?? "-"}</td>
                  <td>{profile.default_approver ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>Request Logs</h3>
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
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.client_code}</td>
                  <td>{log.service_type}</td>
                  <td>{log.project_title}</td>
                  <td>{log.monday_item_id ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
