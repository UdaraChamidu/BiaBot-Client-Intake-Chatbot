import { apiClient, clientHeaders } from "./apiClient";

export async function authenticateClientCode(clientCode) {
  const { data } = await apiClient.post("/auth/client-code", {
    client_code: clientCode,
  });
  return data;
}

export async function fetchIntakeOptions(token) {
  const { data } = await apiClient.get("/intake/options", {
    headers: clientHeaders(token),
  });
  return data;
}

export async function previewIntake(token, payload) {
  const { data } = await apiClient.post("/intake/preview", payload, {
    headers: clientHeaders(token),
  });
  return data;
}

export async function submitIntake(token, payload) {
  const { data } = await apiClient.post("/intake/submit", payload, {
    headers: clientHeaders(token),
  });
  return data;
}
