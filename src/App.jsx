import { useState } from "react";
import {
  BarChart3,
  Bell,
  Box,
  Building2,
  Calculator,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  Home,
  LogOut,
  Menu,
  Package,
  Percent,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Users,
  X,
} from "lucide-react";

const demoUser = {
  name: "Admin User",
  role: "Administrator",
};

const permissions = {
  discount: true,
  voidItem: true,
  voidInvoice: true,
  refund: true,
  priceChange: true,
  inventory: true,
  reports: true,
  manageUsers: true,
  paymentSettings: true,
};

const products = [
  { id: 1, name: "Coca Cola 500ml", category: "Drinks", price: 1.5, stock: 42 },
  { id: 2, name: "Pepsi 500ml", category: "Drinks", price: 1.5, stock: 31 },
  { id: 3, name: "Chicken Sandwich", category: "Food", price: 4.95, stock: 18 },
  { id: 4, name: "Cheese Sandwich", category: "Food", price: 4.5, stock: 23 },
  { id: 5, name: "Crisps - Ready Salted", category: "Snacks", price: 1.25, stock: 56 },
  { id: 6, name: "Chocolate Bar", category: "Snacks", price: 1.2, stock: 64 },
  { id: 7, name: "Mineral Water", category: "Drinks", price: 1.2, stock: 82 },
  { id: 8, name: "Coffee", category: "Hot Drinks", price: 2.5, stock: 100 },
];

const categories = ["All", "Drinks", "Food", "Snacks", "Hot Drinks"];

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    onLogin();
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white mb-4">
            <Calculator size={28} />
          </div>

          <h1 className="text-3xl font-bold text-slate-900">onePOS</h1>
          <p className="text-slate-500 mt-1">
            Point of Sale & Business Management
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-7"
        >
          <h2 className="text-xl font-semibold text-slate-900">
            Sign in
          </h2>

          <p className="text-sm text-slate-500 mt-1 mb-6">
            Sign in to access your onePOS account.
          </p>

          <label className="block text-sm font-medium text-slate-700 mb-2">
            Username
          </label>

          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            className="w-full h-11 px-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />

          <label className="block text-sm font-medium text-slate-700 mt-5 mb-2">
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full h-11 px-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            type="submit"
            className="w-full h-11 mt-6 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
          >
            Sign in
          </button>

          <div className="mt-5 p-3 rounded-lg bg-slate-50 text-xs text-slate-500">
            Development mode: any username/password will sign in.
          </div>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          onePOS
        </p>
      </div>
    </div>
  );
}

function AdminLayout({ onLogout }) {
  const [active, setActive] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menu = [
    {
      section: "MAIN",
      items: [
        { name: "Dashboard", icon: Home },
        { name: "POS", icon: ShoppingCart },
      ],
    },
    {
      section: "SALES",
      items: [
        { name: "Sales", icon: FileText },
        { name: "Payments", icon: CreditCard },
        { name: "Customers", icon: Users },
      ],
    },
    {
      section: "PRODUCTS",
      items: [
        { name: "Products", icon: Package },
        { name: "Inventory", icon: Box },
        { name: "Purchasing", icon: ClipboardList },
      ],
    },
    {
      section: "BUSINESS",
      items: [
        { name: "Stores", icon: Store },
        { name: "Employees", icon: Users },
        { name: "Reports", icon: BarChart3 },
      ],
    },
    {
      section: "SYSTEM",
      items: [
        { name: "Integrations", icon: Building2 },
        { name: "Settings", icon: Settings },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex text-slate-900">
      <aside
        className={`bg-slate-950 text-slate-300 transition-all duration-200 ${
          sidebarOpen ? "w-60" : "w-16"
        }`}
      >
        <div className="h-16 border-b border-slate-800 flex items-center px-4">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white shrink-0">
            <Calculator size={20} />
          </div>

          {sidebarOpen && (
            <span className="ml-3 text-white font-bold text-lg">
              onePOS
            </span>
          )}
        </div>

        <nav className="p-3">
          {menu.map((group) => (
            <div key={group.section} className="mb-5">
              {sidebarOpen && (
                <div className="px-3 mb-2 text-[10px] font-bold tracking-wider text-slate-500">
                  {group.section}
                </div>
              )}

              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = active === item.name;

                return (
                  <button
                    key={item.name}
                    onClick={() => setActive(item.name)}
                    className={`w-full flex items-center rounded-lg px-3 py-2.5 mb-1 text-sm ${
                      selected
                        ? "bg-blue-600 text-white"
                        : "hover:bg-slate-800 text-slate-300"
                    }`}
                  >
                    <Icon size={18} />

                    {sidebarOpen && (
                      <span className="ml-3">{item.name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-100"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <div>
              <div className="font-semibold">{active}</div>
              <div className="text-xs text-slate-400">
                onePOS Administration
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="relative">
              <Bell size={19} className="text-slate-500" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
            </button>

            <div className="h-8 w-px bg-slate-200" />

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                AU
              </div>

              <div className="hidden sm:block">
                <div className="text-sm font-medium">{demoUser.name}</div>
                <div className="text-xs text-slate-400">
                  {demoUser.role}
                </div>
              </div>

              <ChevronDown size={16} className="text-slate-400" />
            </div>

            <button
              onClick={onLogout}
              title="Sign out"
              className="p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="p-5 md:p-7">
          {active === "Dashboard" && <Dashboard />}
          {active === "POS" && <POS />}
          {active !== "Dashboard" && active !== "POS" && (
            <ComingSoon title={active} />
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard() {
  const cards = [
    {
      title: "Today's Sales",
      value: "£8,421.50",
      change: "+12.4%",
    },
    {
      title: "Transactions",
      value: "382",
      change: "+8.2%",
    },
    {
      title: "Average Sale",
      value: "£22.05",
      change: "+3.1%",
    },
    {
      title: "Low Stock",
      value: "14",
      change: "Needs attention",
    },
  ];

  return (
    <>
      <div className="mb-7">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Overview of your business performance.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.title}
            className="bg-white border border-slate-200 rounded-xl p-5"
          >
            <div className="text-sm text-slate-500">{card.title}</div>
            <div className="text-2xl font-bold mt-2">{card.value}</div>
            <div className="text-xs text-emerald-600 mt-2">
              {card.change}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="font-semibold">Sales Overview</h2>
              <p className="text-xs text-slate-400 mt-1">
                Last 7 days
              </p>
            </div>
          </div>

          <div className="h-56 flex items-end gap-3 border-b border-l border-slate-200 px-4 pb-0">
            {[45, 62, 55, 78, 68, 92, 84].map((height, index) => (
              <div
                key={index}
                className="flex-1 bg-blue-500 rounded-t-md"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold">Quick Actions</h2>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <button className="border border-slate-200 rounded-lg p-4 text-left hover:bg-slate-50">
              <Package size={19} className="text-blue-600" />
              <div className="text-sm font-medium mt-2">
                Add Product
              </div>
            </button>

            <button className="border border-slate-200 rounded-lg p-4 text-left hover:bg-slate-50">
              <Users size={19} className="text-blue-600" />
              <div className="text-sm font-medium mt-2">
                Add Customer
              </div>
            </button>

            <button className="border border-slate-200 rounded-lg p-4 text-left hover:bg-slate-50">
              <Percent size={19} className="text-blue-600" />
              <div className="text-sm font-medium mt-2">
                Promotion
              </div>
            </button>

            <button className="border border-slate-200 rounded-lg p-4 text-left hover:bg-slate-50">
              <BarChart3 size={19} className="text-blue-600" />
              <div className="text-sm font-medium mt-2">
                Reports
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function POS() {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]);

  const filteredProducts = products.filter((product) => {
    const categoryMatch =
      category === "All" || product.category === category;

    const searchMatch = product.name
      .toLowerCase()
      .includes(search.toLowerCase());

    return categoryMatch && searchMatch;
  });

  function addProduct(product) {
    setBasket((current) => {
      const existing = current.find((item) => item.id === product.id);

      if (existing) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { ...product, quantity: 1 }];
    });
  }

  function removeProduct(id) {
    setBasket((current) =>
      current
        .map((item) =>
          item.id === id
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  const total = basket.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="fixed inset-0 md:left-60 bg-slate-100 flex flex-col">
      <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-5 shrink-0">
        <div>
          <div className="font-bold">Till 01</div>
          <div className="text-xs text-slate-400">
            London Store
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-emerald-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Online
          </div>

          <button className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
            Hold Sale
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 p-4 min-w-0 overflow-auto">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product or scan barcode..."
                className="w-full h-11 pl-10 pr-3 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-2 overflow-auto pb-3">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                  category === item
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => addProduct(product)}
                className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-blue-400 hover:shadow-sm"
              >
                <div className="h-20 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Package className="text-slate-300" size={30} />
                </div>

                <div className="mt-3 font-medium text-sm">
                  {product.name}
                </div>

                <div className="text-xs text-slate-400 mt-1">
                  {product.category}
                </div>

                <div className="font-bold mt-2">
                  £{product.price.toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        </div>

        <aside className="w-[360px] bg-white border-l border-slate-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-200">
            <div className="font-semibold">Current Sale</div>
            <div className="text-xs text-slate-400 mt-1">
              Customer: Walk-in Customer
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {basket.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-slate-400">
                <div>
                  <ShoppingCart
                    size={40}
                    className="mx-auto mb-3 opacity-40"
                  />
                  <p className="text-sm">Basket is empty</p>
                  <p className="text-xs mt-1">
                    Select a product to begin
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {basket.map((item) => (
                  <div
                    key={item.id}
                    className="border-b border-slate-100 pb-3"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm">
                          {item.name}
                        </div>

                        <div className="text-xs text-slate-400 mt-1">
                          £{item.price.toFixed(2)} × {item.quantity}
                        </div>
                      </div>

                      <div className="font-semibold text-sm">
                        £{(item.price * item.quantity).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => removeProduct(item.id)}
                        className="text-xs border rounded px-2 py-1"
                      >
                        −
                      </button>

                      <button
                        onClick={() => addProduct(item)}
                        className="text-xs border rounded px-2 py-1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-500">Subtotal</span>
              <span>£{total.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-sm mb-3">
              <span className="text-slate-500">VAT</span>
              <span>£0.00</span>
            </div>

            <div className="flex justify-between text-xl font-bold mb-4">
              <span>Total</span>
              <span>£{total.toFixed(2)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {permissions.discount && (
                <button className="h-11 border border-slate-200 rounded-lg text-sm">
                  Discount
                </button>
              )}

              <button
                disabled={!basket.length}
                className="h-11 bg-blue-600 disabled:bg-slate-300 text-white rounded-lg font-semibold"
              >
                Payment
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ComingSoon({ title }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto">
        <Settings size={24} />
      </div>

      <h2 className="text-xl font-bold mt-4">{title}</h2>

      <p className="text-sm text-slate-500 mt-2">
        This module is part of the onePOS roadmap and will be connected to
        the database and API next.
      </p>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <AdminLayout onLogout={() => setAuthenticated(false)} />
  );
}
