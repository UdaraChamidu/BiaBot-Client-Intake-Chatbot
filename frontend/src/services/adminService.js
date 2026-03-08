import { adminHeaders, apiClient } from "./apiClient";

export async function verifyAdminPassword(password) {
  await apiClient.get("/admin/client-profiles", {
    headers: adminHeaders(password),
  });
  return { ok: true };
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

export async function deleteClientProfile(adminPassword, clientCode) {
  await apiClient.delete(`/admin/client-profiles/${encodeURIComponent(clientCode)}`, {
    headers: adminHeaders(adminPassword),
  });
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

export async function getClientLoginEvents(adminPassword, limit = 100) {
  const { data } = await apiClient.get("/admin/client-login-events", {
    headers: adminHeaders(adminPassword),
    params: { limit },
  });
  return data;
}

export async function getAdminNotifications(adminPassword, limit = 100) {
  const { data } = await apiClient.get("/admin/notifications", {
    headers: adminHeaders(adminPassword),
    params: { limit },
  });
  return data;
}

export async function markAdminNotificationRead(adminPassword, notificationId) {
  const { data } = await apiClient.post(
    `/admin/notifications/${encodeURIComponent(notificationId)}/read`,
    {},
    {
      headers: adminHeaders(adminPassword),
    }
  );
  return data;
}

export async function markAllAdminNotificationsRead(adminPassword) {
  const { data } = await apiClient.post(
    "/admin/notifications/read-all",
    {},
    {
      headers: adminHeaders(adminPassword),
    }
  );
  return data;
}

export async function deleteAdminNotification(adminPassword, notificationId) {
  const { data } = await apiClient.delete(
    `/admin/notifications/${encodeURIComponent(notificationId)}`,
    {
      headers: adminHeaders(adminPassword),
    }
  );
  return data;
}
