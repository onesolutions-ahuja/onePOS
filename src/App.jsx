import { useState } from "react";
import {
  BarChart3,
  Calculator,
  ChevronDown,
  CreditCard,
  FileText,
  Grid3X3,
  Home,
  LogOut,
  Menu,
  Package,
  Percent,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";

const categories = [
  "All",
  "Food",
  "Drinks",
  "Snacks",
  "Hot Drinks",
  "Desserts",
];

const products = [
  { id: 1, name: "Coca Cola 500ml", price: 1.5, category: "Drinks" },
  { id: 2, name: "Pepsi 500ml", price: 1.5, category: "Drinks" },
  { id: 3, name: "Mineral Water", price: 1.2, category: "Drinks" },
  { id: 4, name: "Chicken Sandwich", price: 4.95, category: "Food" },
  { id: 5, name: "Cheese Sandwich", price: 4.5, category: "Food" },
  { id: 6, name: "Beef Burger", price: 6.5, category: "Food" },
  { id: 7, name: "Ready Salted Crisps", price: 1.25, category: "Snacks" },
  { id: 8, name: "Chocolate Bar", price: 1.2, category: "Snacks" },
  { id: 9, name: "Coffee", price: 2.5, category: "Hot Drinks" },
  { id: 10, name: "Tea", price: 2.2, category: "Hot Drinks" },
  { id: 11, name: "Latte", price: 3.2, category: "Hot Drinks" },
  { id: 12, name: "Cheesecake", price: 4.25, category: "Desserts" },
];

function Login({ onLogin }) {
  const [pin, setPin] = useState("");

  const enter = (number) => {
    if (pin.length < 6) setPin((value) => value + number);
  };

  const remove = () => {
    setPin((value) => value.slice(0, -1));
  };

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center">
      <div className="w-[420px] max-w-[95vw]">
        <div className="bg-white border border-slate-200 shadow-xl rounded-2xl overflow-hidden">
          <div className="bg-slate-900 text-white p-8 text-center">
            <div className="w-14 h-14 bg-blue-600 rounded-xl mx-auto flex items-center justify-center">
              <Calculator size={28} />
            </div>

            <h1 className="text-2xl font-bold mt-4">onePOS</h1>

            <p className="text-sm text-slate-400 mt-1">
              Sign in to your till
            </p>
          </div>

          <div className="p-7">
            <div className="text-center mb-5">
              <div className="text-sm text-slate-500">Cashier</div>
              <div className="font-semibold text-lg">Select user</div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => enter(n)}
                  className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 text-lg font-semibold"
                >
                  {n}
                </button>
              ))}

              <button
                onClick={remove}
                className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200"
              >
                ←
              </button>

              <button
                onClick={() => enter(0)}
                className="h-12 rounded-lg bg-slate-100 hover:bg-slate-200 text-lg font-semibold"
              >
                0
              </button>

              <button
                onClick={onLogin}
                className="h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Enter
              </button>
            </div>

            <div className="text-center text-xs text-slate-400">
              Till 01 · London Store
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function POS({ onAdmin, onLogout }) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]);
  const [showPayment, setShowPayment] = useState(false);

  const filtered = products.filter((product) => {
    const categoryMatch =
      category === "All" || product.category === category;

    const searchMatch = product.name
      .toLowerCase()
      .includes(search.toLowerCase());

    return categoryMatch && searchMatch;
  });

  const add = (product) => {
    setBasket((current) => {
      const found = current.find((item) => item.id === product.id);

      if (found) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { ...product, quantity: 1 }];
    });
  };

  const decrease = (id) => {
    setBasket((current) =>
      current
        .map((item) =>
          item.id === id
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const subtotal = basket.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  const vat = subtotal * 0.2;
  const total = subtotal + vat;

  return (
    <div className="h-screen bg-[#eef1f4] flex flex-col overflow-hidden">
      <header className="h-[58px] bg-slate-900 text-white flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-bold text-lg">onePOS</div>

          <div className="h-7 w-px bg-slate-700" />

          <div className="text-sm">
            <span className="font-medium">Till 01</span>
            <span className="text-slate-400 ml-2">London Store</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <span className="w-2 h-2 bg-emerald-400 rounded-full" />
            Online
          </div>

          <button
            onClick={onAdmin}
            className="px-3 py-2 bg-slate-800 rounded-md text-sm hover:bg-slate-700"
          >
            Admin
          </button>

          <button
            onClick={onLogout}
            className="p-2 hover:bg-slate-800 rounded-md"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[150px] bg-white border-r border-slate-200 p-2 shrink-0 overflow-y-auto">
          <div className="text-[10px] font-bold text-slate-400 px-2 py-2">
            CATEGORIES
          </div>

          {categories.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`w-full text-left px-3 py-3 rounded-md mb-1 text-sm font-medium ${
                category === item
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item}
            </button>
          ))}
        </aside>

        <section className="flex-1 flex flex-col min-w-0 p-3">
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search
                size={19}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product or scan barcode..."
                className="w-full h-12 bg-white border border-slate-200 rounded-md pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button className="w-12 h-12 bg-white border border-slate-200 rounded-md flex items-center justify-center">
              <Grid3X3 size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  onClick={() => add(product)}
                  className="bg-white border border-slate-200 rounded-md p-3 text-left hover:border-blue-500 hover:shadow-sm active:scale-[0.98] transition"
                >
                  <div className="h-20 bg-slate-100 rounded flex items-center justify-center">
                    <Package size={28} className="text-slate-300" />
                  </div>

                  <div className="font-semibold text-sm mt-2 line-clamp-2">
                    {product.name}
                  </div>

                  <div className="text-xs text-slate-400 mt-1">
                    {product.category}
                  </div>

                  <div className="font-bold text-lg mt-2">
                    £{product.price.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="h-[58px] bg-white border border-slate-200 rounded-md mt-3 flex items-center gap-2 px-2">
            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              Hold Sale
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              Customer
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              <Percent size={15} className="inline mr-1" />
              Discount
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              Void
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              More
            </button>
          </div>
        </section>

        <aside className="w-[350px] bg-white border-l border-slate-200 flex flex-col shrink-0">
          <div className="h-[58px] border-b border-slate-200 flex items-center justify-between px-4">
            <div>
              <div className="font-bold">Current Sale</div>
              <div className="text-xs text-slate-400">
                Walk-in Customer
              </div>
            </div>

            <Receipt size={20} className="text-slate-400" />
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {basket.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <ShoppingCart size={42} strokeWidth={1.5} />

                <div className="font-medium mt-3">
                  No items
                </div>

                <div className="text-xs mt-1">
                  Scan a barcode or select a product
                </div>
              </div>
            ) : (
              <div>
                {basket.map((item) => (
                  <div
                    key={item.id}
                    className="border-b border-slate-100 py-3"
                  >
                    <div className="flex justify-between gap-2">
                      <div className="font-medium text-sm">
                        {item.name}
                      </div>

                      <div className="font-semibold text-sm">
                        £{(item.price * item.quantity).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center border border-slate-200 rounded">
                        <button
                          onClick={() => decrease(item.id)}
                          className="w-8 h-8 hover:bg-slate-100"
                        >
                          −
                        </button>

                        <span className="w-8 text-center text-sm">
                          {item.quantity}
                        </span>

                        <button
                          onClick={() => add(item)}
                          className="w-8 h-8 hover:bg-slate-100"
                        >
                          +
                        </button>
                      </div>

                      <span className="text-xs text-slate-400">
                        £{item.price.toFixed(2)} each
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-500">Subtotal</span>
              <span>£{subtotal.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-sm mb-3">
              <span className="text-slate-500">VAT</span>
              <span>£{vat.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-xl font-bold mb-4">
              <span>Total</span>
              <span>£{total.toFixed(2)}</span>
            </div>

            <button
              disabled={basket.length === 0}
              onClick={() => setShowPayment(true)}
              className="w-full h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-md text-lg font-bold flex items-center justify-center gap-2"
            >
              <CreditCard size={21} />
              PAYMENT
            </button>
          </div>
        </aside>
      </div>

      {showPayment && (
        <PaymentModal
          total={total}
          onClose={() => setShowPayment(false)}
          onComplete={() => {
            setBasket([]);
            setShowPayment(false);
          }}
        />
      )}
    </div>
  );
}

function PaymentModal({ total, onClose, onComplete }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-[520px] max-w-[95vw] shadow-2xl">
        <div className="p-5 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-xl">Payment</h2>
            <div className="text-sm text-slate-400">
              Amount due
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="text-center mb-6">
            <div className="text-sm text-slate-500">Total</div>
            <div className="text-4xl font-bold mt-1">
              £{total.toFixed(2)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onComplete}
              className="h-24 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50"
            >
              <Wallet className="mx-auto" size={27} />
              <div className="font-semibold mt-2">Cash</div>
            </button>

            <button
              onClick={onComplete}
              className="h-24 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50"
            >
              <CreditCard className="mx-auto" size={27} />
              <div className="font-semibold mt-2">Card</div>
            </button>

            <button className="h-20 border-2 border-slate-200 rounded-xl">
              Split Payment
            </button>

            <button className="h-20 border-2 border-slate-200 rounded-xl">
              Other
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Admin({ onPOS, onLogout }) {
  const [page, setPage] = useState("Dashboard");

  const items = [
    ["Dashboard", Home],
    ["Sales", FileText],
    ["Products", Package],
    ["Inventory", Grid3X3],
    ["Customers", Users],
    ["Employees", Users],
    ["Stores", Store],
    ["Payments", CreditCard],
    ["Reports", BarChart3],
    ["Settings", Settings],
  ];

  return (
    <div className="h-screen bg-slate-100 flex">
      <aside className="w-60 bg-slate-950 text-white shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-slate-800">
          <Calculator size={22} className="text-blue-400" />
          <span className="font-bold text-lg ml-3">onePOS</span>
        </div>

        <div className="p-3">
          {items.map(([name, Icon]) => (
            <button
              key={name}
              onClick={() => setPage(name)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md mb-1 text-sm ${
                page === name
                  ? "bg-blue-600"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="h-16 bg-white border-b flex items-center justify-between px-6">
          <div>
            <div className="font-semibold">{page}</div>
            <div className="text-xs text-slate-400">
              London Store
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onPOS}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm"
            >
              Open Till
            </button>

            <button
              onClick={onLogout}
              className="p-2 hover:bg-slate-100 rounded"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="p-6">
          {page === "Dashboard" ? (
            <Dashboard />
          ) : (
            <div className="bg-white rounded-xl border p-10 text-center">
              <h2 className="text-xl font-bold">{page}</h2>
              <p className="text-sm text-slate-400 mt-2">
                Module will be connected to the onePOS API.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard() {
  const stats = [
    ["Today's Sales", "£8,421.50", "+12.4%"],
    ["Transactions", "382", "+8.2%"],
    ["Average Sale", "£22.05", "+3.1%"],
    ["Low Stock", "14", "Needs attention"],
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Good afternoon</h1>
        <p className="text-sm text-slate-500 mt-1">
          Here's what's happening in your business today.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map(([label, value, change]) => (
          <div
            key={label}
            className="bg-white border rounded-xl p-5"
          >
            <div className="text-sm text-slate-500">{label}</div>
            <div className="text-2xl font-bold mt-2">{value}</div>
            <div className="text-xs text-emerald-600 mt-2">
              {change}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5 mt-5">
        <div className="col-span-2 bg-white border rounded-xl p-5">
          <div className="font-semibold">Sales Overview</div>

          <div className="h-64 flex items-end gap-4 mt-8 px-5 border-b border-l">
            {[45, 60, 52, 75, 64, 88, 78, 94].map((height, i) => (
              <div
                key={i}
                className="flex-1 bg-blue-500 rounded-t"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div className="bg-white border rounded-xl p-5">
          <div className="font-semibold mb-5">Quick Actions</div>

          <button className="w-full p-4 border rounded-lg text-left mb-3">
            <Package size={19} className="text-blue-600" />
            <div className="font-medium mt-2">Add Product</div>
          </button>

          <button className="w-full p-4 border rounded-lg text-left mb-3">
            <Users size={19} className="text-blue-600" />
            <div className="font-medium mt-2">Add Customer</div>
          </button>

          <button className="w-full p-4 border rounded-lg text-left">
            <BarChart3 size={19} className="text-blue-600" />
            <div className="font-medium mt-2">View Reports</div>
          </button>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState("pos");

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  if (view === "admin") {
    return (
      <Admin
        onPOS={() => setView("pos")}
        onLogout={() => setLoggedIn(false)}
      />
    );
  }

  return (
    <POS
      onAdmin={() => setView("admin")}
      onLogout={() => setLoggedIn(false)}
    />
  );
}
