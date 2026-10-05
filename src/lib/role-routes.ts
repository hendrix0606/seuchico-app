import type { Href } from "expo-router";
import type { UserRole } from "../context/auth-context";

export function routeForRole(role?: UserRole): Href {
  if (role === "admin") return "/admin";
  if (role === "courier") return "/entregador";
  return "/cliente";
}

export function roleLabel(role?: UserRole) {
  if (role === "admin") return "Administrador";
  if (role === "courier") return "Entregador";
  return "Cliente";
}
