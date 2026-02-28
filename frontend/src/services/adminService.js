import { adminHeaders, apiClient } from "./apiClient";

export async function verifyAdminPassword(password) {
  const { data } = await apiClient.post("/admin/auth", { password });
  return data;
}

export async function getClientProfiles(adminPassword) {
  const { data } = await apiClient.get("/admin/client-profiles", {
    headers: adminHeaders(adminPassword),
  });
  return data;
}

export async function upsertClientProfile(adminPassword, profile) {
  const { data } = await apiClient.post("/admin/client-profiles", profile, {
    headers: adminHeaders(adminPassword),
  });
  return data;
}

export async function getServiceOptions(adminPassword) {
  const { data } = await apiClient.get("/admin/service-options", {
    headers: adminHeaders(adminPassword),
  });
  return data;
}

export async function updateServiceOptions(adminPassword, options) {
  const { data } = await apiClient.put(
    "/admin/service-options",
    { options },
    {
      headers: adminHeaders(adminPassword),
    }
  );
  return data;
}

export async function getRequestLogs(adminPassword, limit = 100) {
  const { data } = await apiClient.get("/admin/request-logs", {
    headers: adminHeaders(adminPassword),
    params: { limit },
  });
  return data;
}
