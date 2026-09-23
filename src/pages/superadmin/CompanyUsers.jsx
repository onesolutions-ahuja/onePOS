import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";

export default function CompanyUsers() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(() => new URLSearchParams(window.location.search).get("companyId") || "");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/superadmin/companies").then((result) => {
      if (!result.success) throw new Error(result.message || "Unable to load companies");
      if (!cancelled) setCompanies(result.data || []);
    }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUsers([]);
    setError("");
    setLoading(Boolean(companyId));
    if (companyId) {
      apiRequest(`/api/superadmin/companies/${encodeURIComponent(companyId)}/users`).then((result) => {
        if (!result.success) throw new Error(result.message || "Unable to load company users");
        if (!cancelled) setUsers(result.data || []);
      }).catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [companyId]);

  const visibleUsers = users.filter((user) => [user.full_name, user.email, user.username]
    .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));

  return <section className="onepos-card onepos-card-body space-y-4">
    <h2 className="onepos-card-title">Company users</h2>
    <p className="text-sm text-slate-600">View saved tenant accounts, including the initial Company Admin.</p>
    <label className="block">Company
      <select className="onepos-input w-full" value={companyId} onChange={(event) => {
        setCompanyId(event.target.value);
        setSearch("");
        const url = new URL(window.location.href);
        if (event.target.value) url.searchParams.set("companyId", event.target.value);
        else url.searchParams.delete("companyId");
        window.history.replaceState({}, "", url);
      }}>
        <option value="">Select company</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </label>
    <input className="onepos-input w-full" aria-label="Search company users" placeholder="Search company users by name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading company users...</p> : !companyId ? <p>Select a company to view its users.</p> : <div className="overflow-x-auto">
      <table className="onepos-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>{visibleUsers.map((user) => <tr key={user.id}>
          <td>{user.full_name || user.username}</td><td>{user.email || "—"}</td>
          <td>{user.role_name || "—"}</td><td>{user.active ? "Active" : "Inactive"}</td>
        </tr>)}</tbody>
      </table>
      {!visibleUsers.length && <p>No company users found.</p>}
    </div>}
  </section>;
}
