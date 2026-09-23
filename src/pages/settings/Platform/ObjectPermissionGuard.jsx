import React from "react";

export default function ObjectPermissionGuard({
  allowed = true,
  children,
  fallback = null,
}) {
  if (!allowed) {
    return fallback;
  }

  return <>{children}</>;
}
