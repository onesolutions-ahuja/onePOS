export function databaseConfigurationPayload(form) {
  return {
    databaseMode: form.databaseMode,
    host: form.host,
    port: Number(form.port) || 5432,
    database: form.database,
    username: form.username,
    sslMode: form.sslMode,
    ...(form.password ? { password: form.password } : {}),
  };
}
