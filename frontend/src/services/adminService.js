import { adminHeaders, apiClient } from "./apiClient";

export async function getClientProfiles(adminKey) {
  const { data } = await apiClient.get("/admin/client-profiles", {
    headers: adminHeaders(adminKey),
  });
  return data;
}

export async function upsertClientProfile(adminKey, profile) {
  const { data } = await apiClient.post("/admin/client-profiles", profile, {
    headers: adminHeaders(adminKey),
  });
  return data;
}

export async function getServiceOptions(adminKey) {
  const { data } = await apiClient.get("/admin/service-options", {
    headers: adminHeaders(adminKey),
  });
  return data;
}

export async function updateServiceOptions(adminKey, options) {
  const { data } = await apiClient.put(
    "/admin/service-options",
    { options },
    {
      headers: adminHeaders(adminKey),
    }
  );
  return data;
}

export async function getRequestLogs(adminKey) {
  const { data } = await apiClient.get("/admin/request-logs", {
    headers: adminHeaders(adminKey),
  });
  return data;
}
