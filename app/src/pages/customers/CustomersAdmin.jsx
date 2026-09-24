import { useEffect, useState } from "react";
import { BookOpen, Edit, Eye, Gift, Plus, RefreshCw, Search, UserPlus, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "../../components/ui.jsx";
import CustomerLoyaltyModal from "./CustomerLoyaltyModal.jsx";
import CustomerCreditModal from "./CustomerCreditModal.jsx";
import StandardObjectFormModal from "../../components/platform/StandardObjectFormModal.jsx";
import StandardObjectViewModal from "../../components/platform/StandardObjectViewModal.jsx";
import SaleDetailModal from "../sales/SaleDetailModal.jsx";

function CustomersAdmin({ entitlements = {}, permissions = [], isAdmin = false }) {
  const loyaltyLicensed = entitlements.loyalty === true;
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formCustomer, setFormCustomer] = useState(null);
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [historySale, setHistorySale] = useState(null);
  const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const canManageCredit = isAdmin || permissions.includes("customer.edit");
  const canTakeCustomerPayment = isAdmin || permissions.includes("payment.manage") || permissions.includes("customer.edit");

  const loadCustomers = async (value = search) => {
    try {
      setLoading(true);
      setError("");
      const suffix = value.trim() ? `?search=${encodeURIComponent(value.trim())}` : "";
      const data = await apiRequest(`/api/customers${suffix}`);
      if (!data.success) throw new Error(data.message || "Unable to load customers");
      setCustomers(data.data || []);
    } catch (err) {
      setError(err.message || "Unable to load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => loadCustomers(), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const toggle = async (customer) => {
    try {
      const data = await apiRequest(`/api/platform/objects/customer/records/${encodeURIComponent(customer.id)}`, {
        method: "PUT",
        body: JSON.stringify({ data: { active: !customer.active } }),
      });
      if (!data.success) throw new Error(data.message);
      await loadCustomers();
      setMessage(customer.active ? "Customer deactivated." : "Customer activated.");
    } catch (err) {
      setError(err.message || "Unable to update customer");
    }
  };

  const view = async (customer) => {
    try {
      const data = await apiRequest(`/api/customers/${customer.id}`);
      if (!data.success) throw new Error(data.message);
      setDetailCustomer(data.data);
    } catch (err) {
      setError(err.message || "Unable to load customer");
    }
  };

  const openHistorySale = async (sale) => {
    try {
      const data = await apiRequest(`/api/sales/${sale.id}`);
      if (!data.success) throw new Error(data.message || "Unable to load sale");
      setHistorySale(data.sale || data.data || sale);
    } catch (err) {
      setError(err.message || "Unable to load sale");
    }
  };

  const activeCount = customers.filter((c) => c.active).length;

  return (
    <div className="admin-page">
      <PageHeader
        title="Customers"
        subtitle="Manage customer records, contact details and store associations."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadCustomers()}
            >
              <RefreshCw size={15} />
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setFormCustomer({})}
            >
              <Plus size={15} />
              Add Customer
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Total customers</div>
            <div className="text-lg font-bold text-slate-800">{customers.length}</div>
          </div>
        </div>
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserPlus size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Active</div>
            <div className="text-lg font-bold text-slate-800">{activeCount}</div>
          </div>
        </div>
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
            <Users size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Inactive</div>
            <div className="text-lg font-bold text-slate-800">{customers.length - activeCount}</div>
          </div>
        </div>
      </div>

      {message && (
        <div className="mb-3">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <span>Customer list</span>
              {customers.length > 0 && (
                <Badge tone="neutral">{customers.length}</Badge>
              )}
            </div>
          }
          actions={
            <div className="relative w-80">
              <Search
                size={15}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, phone or email"
                className="pl-8"
              />
            </div>
          }
        />

        {loading ? (
          <EmptyState
            title="Loading customers"
            hint="Fetching customer records from the server"
          >
            <RefreshCw size={24} className="animate-spin" />
          </EmptyState>
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            hint={search ? "Try adjusting your search query" : "Add your first customer to get started"}
          >
            <Users size={28} />
            {!search && (
              <div className="mt-3">
                <Button size="sm" onClick={() => setFormCustomer({})}>
                  <Plus size={14} />
                  Add Customer
                </Button>
              </div>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="onepos-table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Reference</th>
                  {loyaltyLicensed && <th>Loyalty Balance</th>}
                  <th>Stores</th>
                  <th>Last purchase</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="group">
                    <td className="py-2 px-3">
                      <div className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold">
                        {customer.name.charAt(0).toUpperCase()}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold text-slate-800">
                        {customer.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        ID: {customer.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="font-mono text-xs">{customer.phone || "-"}</td>
                    <td className="text-xs">{customer.email || "-"}</td>
                    <td className="font-mono text-xs">
                      {customer.loyalty_number ? (
                        <Badge tone="info">#{customer.loyalty_number}</Badge>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    {loyaltyLicensed && <td className="font-semibold text-sm">
                      £{Number(customer.loyalty_balance || 0).toFixed(2)}
                    </td>}
                    <td className="text-xs">
                      <span className="text-slate-600">
                        {customer.store_names || "Current store"}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {customer.last_purchase_at
                        ? new Date(customer.last_purchase_at).toLocaleDateString()
                        : "-"}
                    </td>
                    <td>
                      <Badge tone={customer.active ? "success" : "neutral"}>
                        {customer.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailCustomer(customer)}
                          className="px-2"
                          title="View details"
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setDetailCustomer(customer); setShowLoyaltyModal(true); }}
                          className="px-2"
                          title="View loyalty"
                        >
                          <Gift size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setDetailCustomer(customer); setShowCreditModal(true); }}
                          className="px-2"
                          title="Customer credit"
                        >
                          <BookOpen size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormCustomer(customer)}
                          className="px-2"
                          title="Edit customer"
                        >
                          <Edit size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(customer)}
                          className="px-2"
                          title={customer.active ? "Deactivate" : "Activate"}
                        >
                          {customer.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {formCustomer && (
        <StandardObjectFormModal
          objectKey="customer"
          customer={formCustomer}
          record={formCustomer}
          mode={formCustomer?.id ? "edit" : "quick_create"}
          onClose={() => setFormCustomer(null)}
          onSaved={async () => {
            await loadCustomers();
            setFormCustomer(null);
            setMessage(formCustomer?.id ? "Customer updated." : "Customer saved.");
          }}
        />
      )}
      {detailCustomer && (
        <StandardObjectViewModal
          objectKey="customer"
          record={detailCustomer}
          customer={detailCustomer}
          onClose={() => setDetailCustomer(null)}
          title={detailCustomer.name}
        />
      )}
      {showLoyaltyModal && (
        <CustomerLoyaltyModal
          customer={detailCustomer}
          onClose={() => setShowLoyaltyModal(false)}
        />
      )}
      {showCreditModal && (
        <CustomerCreditModal
          customer={detailCustomer}
          canManageCredit={canManageCredit}
          canTakePayment={canTakeCustomerPayment}
          onClose={() => setShowCreditModal(false)}
        />
      )}
    </div>
  );
}

function CustomerAdminDetail({ customer, onClose, onEdit, onToggle }) {
  const totalSpent =
    customer.sales?.reduce((sum, s) => sum + Number(s.total || 0), 0) || 0;
  const totalOrders = customer.sales?.length || 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[780px] max-w-full max-h-[90vh] shadow-lg flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-base font-bold">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="onepos-card-title">{customer.name}</h2>
                <Badge tone={customer.active ? "success" : "neutral"}>
                  {customer.active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Customer ID: {customer.id.slice(0, 12)}
                {customer.loyalty_number && (
                  <span className="ml-2">Loyalty: #{customer.loyalty_number}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Edit size={14} />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {customer.active ? "Deactivate" : "Activate"}
            </Button>
            <button
              onClick={onClose}
              className="p-1.5 ml-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <div>
              <div className="text-xs text-slate-500">Total orders</div>
              <div className="text-lg font-bold text-slate-800">{totalOrders}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Total spent</div>
              <div className="text-lg font-bold text-slate-800">
                £{totalSpent.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Avg order value</div>
              <div className="text-lg font-bold text-slate-800">
                £{totalOrders > 0 ? (totalSpent / totalOrders).toFixed(2) : "0.00"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Store associations</div>
              <div className="text-lg font-bold text-slate-800">
                {(customer.stores || []).length}
              </div>
            </div>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-5">
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Phone</div>
                <div className="font-medium text-slate-800 font-mono">
                  {customer.phone || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Email</div>
                <div className="font-medium text-slate-800">
                  {customer.email || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Address</div>
                <div className="font-medium text-slate-800">
                  {customer.address || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Postcode</div>
                <div className="font-medium text-slate-800">
                  {customer.postcode || "-"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-slate-500 mb-0.5">Notes</div>
                <div className="font-medium text-slate-800 whitespace-pre-wrap">
                  {customer.notes || "-"}
                </div>
              </div>
            </div>

            <div className="mb-5">
              <h3 className="onepos-section-title mb-2">Store associations</h3>
              {customer.stores?.length ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {customer.stores.map((store) => (
                      <span
                        key={store.storeId}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700"
                      >
                      {store.storeName}
                      {store.active ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Active" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" title="Inactive" />
                      )}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">No store associations.</p>
              )}
            </div>

            <div>
              <h3 className="onepos-section-title mb-2">
                Sales history
                {totalOrders > 0 && (
                  <Badge tone="neutral" className="ml-2">
                    {totalOrders}
                  </Badge>
                )}
              </h3>
              {customer.sales?.length ? (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="onepos-table">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Store</th>
                        <th>Date</th>
                        <th>Payment</th>
                        <th>Status</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.sales.map((sale) => (
                        <tr key={sale.id} onClick={() => openHistorySale(sale)} className="cursor-pointer">
                          <td className="font-mono text-xs">
                            {sale.receipt_number || sale.id.slice(0, 8)}
                          </td>
                          <td className="text-xs">{sale.store_name || "-"}</td>
                          <td className="text-xs whitespace-nowrap">
                            {new Date(sale.created_at).toLocaleDateString()}
                          </td>
                          <td>
                            <Badge
                              tone={
                                sale.status === "completed" || sale.status === "paid"
                                  ? "success"
                                  : sale.status === "refunded"
                                  ? "danger"
                                  : "warning"
                              }
                            >
                              {sale.status}
                            </Badge>
                          </td>
                          <td className="text-xs">{sale.payment_method || "-"}</td>
                          <td className="text-right font-semibold text-slate-800">
                            £{Number(sale.total || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No sales history"
                  hint="Purchases from this customer will appear here"
                >
                  <Users size={22} />
                </EmptyState>
              )}
            </div>
            {historySale && <SaleDetailModal sale={historySale} onClose={() => setHistorySale(null)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomersAdmin;
