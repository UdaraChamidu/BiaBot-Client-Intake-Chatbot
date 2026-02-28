import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

export function clientHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function adminHeaders(adminPassword) {
  return {
    "x-admin-password": adminPassword,
    "x-admin-key": adminPassword,
  };
}
