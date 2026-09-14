import React, { useMemo, useState } from "react";
import {
  BarChart3,
  Boxes,
  Calculator,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Grid2X2,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Users,
  X,
} from "lucide-react";

import "./style.css";

const initialProducts = [
  {
    id: 1,
    name: "Coca Cola 500ml",
    category: "Drinks",
    price: 1.5,
    stock: 42,
    barcode: "5449000000996",
  },
  {
    id: 2,
    name: "Pepsi 500ml",
    category: "Drinks",
    price: 1.5,
    stock: 36,
    barcode: "4060800100001",
  },
  {
    id: 3,
    name: "Water 500ml",
    category: "Drinks",
    price: 1.0,
    stock: 85,
    barcode: "5010017000000",
  },
  {
    id: 4,
    name: "Orange Juice",
    category: "Drinks",
    price: 2.2,
    stock: 24,
    barcode: "5012345000001",
  },
  {
    id: 5,
    name: "Chicken Sandwich",
    category: "Food",
    price: 3.95,
    stock: 18,
    barcode: "5012345000002",
  },
  {
    id: 6,
    name: "Tuna Sandwich",
    category: "Food",
    price: 3.75,
    stock: 14,
    barcode: "5012345000003",
  },
  {
    id: 7,
    name: "Cheese Sandwich",
    category: "Food",
    price: 3.5,
    stock: 21,
    barcode: "5012345000004",
  },
  {
    id: 8,
    name: "Crisps",
    category: "Snacks",
    price: 1.2,
    stock: 54,
    barcode: "5012345000005",
  },
  {
    id: 9,
    name: "Chocolate Bar",
    category: "Snacks",
    price: 1.4,
    stock: 48,
    barcode: "5012345000006",
  },
  {
    id: 10,
    name: "Biscuits",
    category: "Snacks",
    price: 1.8,
    stock: 31,
    barcode: "5012345000007",
  },
  {
    id: 11,
    name: "Milk 2L",
    category: "Grocery",
    price: 2.1,
    stock: 16,
    barcode: "5012345000008",
  },
  {
    id: 12,
    name: "Bread",
    category: "Grocery",
    price: 1.45,
    stock: 20,
    barcode: "5012345000009",
  },
];

const categories = ["All", "Drinks", "Food", "Snacks", "Grocery"];

function money(value) {
  return `£${value.toFixed(2)}`;
}

export default function App() {
  const [screen, setScreen] = useState("pos");
  const [products] = useState(initialProducts);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        category === "All" || product.category === category;

      const text = search.toLowerCase();

      const matchesSearch =
        !text ||
        product.name.toLowerCase().includes(text) ||
        product.barcode.includes(text);

      return matchesCategory && matchesSearch;
    });
  }, [products, category, search]);

  const subtotal = basket.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  const discountAmount = Math.min(
    subtotal,
    Math.max(0, (subtotal * discount) / 100)
  );

  const total = subtotal - discountAmount;

  function addToBasket(product) {
    setBasket((current) => {
      const existing = current.find((item) => item.id === product.id);

      if (existing) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...current,
        {
          ...product,
          quantity: 1,
        },
      ];
    });
  }

  function changeQuantity(id, amount) {
    setBasket((current) =>
      current
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: Math.max(0, item.quantity + amount),
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeItem(id) {
    setBasket((current) => current.filter((item) => item.id !== id));
  }

  function clearSale() {
    setBasket([]);
    setDiscount(0);
  }

  function completePayment(method) {
    alert(
      `Payment completed\n\nMethod: ${method}\nTotal: ${money(
        total
      )}\n\nReceipt printing will be connected later.`
    );

    clearSale();
    setPaymentOpen(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">1</div>
          <div>
            <div className="brand-name">onePOS</div>
            <div className="brand-subtitle">Point of Sale</div>
          </div>
        </div>

        <div className="store-info">
          <Store size={17} />
          <span>London Store</span>
          <span className="separator">•</span>
          <span>Till 01</span>
          <span className="online-status">
            <span className="status-dot" />
            Online
          </span>
        </div>

        <div className="top-actions">
          <button className="icon-button" title="Settings">
            <Settings size={19} />
          </button>

          <button
            className="user-button"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="avatar">AD</span>
            <span>Admin</span>
            <ChevronDown size={16} />
          </button>

          {menuOpen && (
            <div className="user-menu">
              <div className="user-menu-name">Administrator</div>
              <div className="user-menu-role">Company Admin</div>
              <button>
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <button
            className={`nav-button ${screen === "pos" ? "active" : ""}`}
            onClick={() => setScreen("pos")}
          >
            <ShoppingCart size={20} />
            <span>POS</span>
          </button>

          <button
            className={`nav-button ${
              screen === "products" ? "active" : ""
            }`}
            onClick={() => setScreen("products")}
          >
            <Package size={20} />
            <span>Products</span>
          </button>

          <button
            className={`nav-button ${
              screen === "inventory" ? "active" : ""
            }`}
            onClick={() => setScreen("inventory")}
          >
            <Boxes size={20} />
            <span>Inventory</span>
          </button>

          <button
            className={`nav-button ${
              screen === "customers" ? "active" : ""
            }`}
            onClick={() => setScreen("customers")}
          >
            <Users size={20} />
            <span>Customers</span>
          </button>

          <button
            className={`nav-button ${
              screen === "reports" ? "active" : ""
            }`}
            onClick={() => setScreen("reports")}
          >
            <BarChart3 size={20} />
            <span>Reports</span>
          </button>

          <div className="sidebar-spacer" />

          <button className="nav-button">
            <Calculator size={20} />
            <span>Till</span>
          </button>

          <button className="nav-button">
            <Settings size={20} />
            <span>Settings</span>
          </button>
        </aside>

        <main className="main">
          {screen === "pos" && (
            <POSScreen
              categories={categories}
              category={category}
              setCategory={setCategory}
              search={search}
              setSearch={setSearch}
              filteredProducts={filteredProducts}
              addToBasket={addToBasket}
              basket={basket}
              changeQuantity={changeQuantity}
              removeItem={removeItem}
              subtotal={subtotal}
              discount={discount}
              setDiscount={setDiscount}
              discountAmount={discountAmount}
              total={total}
              clearSale={clearSale}
              paymentOpen={paymentOpen}
              setPaymentOpen={setPaymentOpen}
              completePayment={completePayment}
            />
          )}

          {screen === "products" && (
            <SimpleAdminScreen
              title="Products"
              icon={<Package size={21} />}
              description="Manage your products, prices and barcodes."
              columns={["Product", "Category", "Barcode", "Price", "Stock"]}
              rows={products.map((product) => [
                product.name,
                product.category,
                product.barcode,
                money(product.price),
                product.stock,
              ])}
            />
          )}

          {screen === "inventory" && (
            <SimpleAdminScreen
              title="Inventory"
              icon={<Boxes size={21} />}
              description="Monitor stock across your store."
              columns={["Product", "Category", "Current Stock", "Status"]}
              rows={products.map((product) => [
                product.name,
                product.category,
                product.stock,
                product.stock < 20 ? "Low stock" : "In stock",
              ])}
            />
          )}

          {screen === "customers" && (
            <SimpleAdminScreen
              title="Customers"
              icon={<Users size={21} />}
              description="Customer records and purchase history."
              columns={["Customer", "Email", "Phone", "Orders"]}
              rows={[
                ["John Smith", "john@example.com", "07700 100001", "24"],
                ["Sarah Jones", "sarah@example.com", "07700 100002", "18"],
                ["Michael Brown", "michael@example.com", "07700 100003", "11"],
              ]}
            />
          )}

          {screen === "reports" && <ReportsScreen />}
        </main>
      </div>
    </div>
  );
}

function POSScreen({
  categories,
  category,
  setCategory,
  search,
  setSearch,
  filteredProducts,
  addToBasket,
  basket,
  changeQuantity,
  removeItem,
  subtotal,
  discount,
  setDiscount,
  discountAmount,
  total,
  clearSale,
  paymentOpen,
  setPaymentOpen,
  completePayment,
}) {
  return (
    <div className="pos-page">
      <section className="products-panel">
        <div className="page-heading">
          <div>
            <h1>New Sale</h1>
            <p>Select a product or scan a barcode to begin.</p>
          </div>

          <button className="secondary-button">
            <ClipboardList size={17} />
            Held Sales
          </button>
        </div>

        <div className="search-row">
          <div className="search-box">
            <Search size={19} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product or scan barcode..."
              autoComplete="off"
            />
            {search && (
              <button
                className="clear-search"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="categories">
          {categories.map((item) => (
            <button
              key={item}
              className={`category-button ${
                category === item ? "active" : ""
              }`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="product-grid">
          {filteredProducts.map((product) => (
            <button
              className="product-card"
              key={product.id}
              onClick={() => addToBasket(product)}
            >
              <div className="product-image">
                <Package size={27} />
              </div>

              <div className="product-card-info">
                <div className="product-name">{product.name}</div>
                <div className="product-category">{product.category}</div>
              </div>

              <div className="product-bottom">
                <strong>{money(product.price)}</strong>
                <span>{product.stock} in stock</span>
              </div>
            </button>
          ))}

          {filteredProducts.length === 0 && (
            <div className="empty-products">
              <Search size={30} />
              <strong>No products found</strong>
              <span>Try another search or category.</span>
            </div>
          )}
        </div>
      </section>

      <section className="basket-panel">
        <div className="basket-header">
          <div>
            <h2>Current Sale</h2>
            <span>
              {basket.reduce((sum, item) => sum + item.quantity, 0)} items
            </span>
          </div>

          {basket.length > 0 && (
            <button className="text-danger" onClick={clearSale}>
              Clear
            </button>
          )}
        </div>

        <div className="basket-items">
          {basket.length === 0 ? (
            <div className="empty-basket">
              <div className="empty-basket-icon">
                <ShoppingCart size={29} />
              </div>
              <strong>Basket is empty</strong>
              <span>Select products to add them to the sale.</span>
            </div>
          ) : (
            basket.map((item) => (
              <div className="basket-item" key={item.id}>
                <div className="basket-item-main">
                  <div className="basket-item-name">{item.name}</div>
                  <div className="basket-item-price">
                    {money(item.price)} each
                  </div>
                </div>

                <div className="quantity-control">
                  <button onClick={() => changeQuantity(item.id, -1)}>
                    −
                  </button>

                  <span>{item.quantity}</span>

                  <button onClick={() => changeQuantity(item.id, 1)}>
                    +
                  </button>
                </div>

                <div className="basket-item-total">
                  {money(item.price * item.quantity)}
                </div>

                <button
                  className="remove-item"
                  onClick={() => removeItem(item.id)}
                >
                  <X size={15} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sale-summary">
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>{money(subtotal)}</strong>
          </div>

          <div className="discount-row">
            <span>Discount</span>

            <select
              value={discount}
              onChange={(event) => setDiscount(Number(event.target.value))}
            >
              <option value={0}>None</option>
              <option value={5}>5%</option>
              <option value={10}>10%</option>
              <option value={15}>15%</option>
              <option value={20}>20%</option>
            </select>

            <strong>-{money(discountAmount)}</strong>
          </div>

          <div className="total-row">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>

          <button
            className="pay-button"
            disabled={basket.length === 0}
            onClick={() => setPaymentOpen(true)}
          >
            <CreditCard size={20} />
            Pay {money(total)}
          </button>

          <div className="quick-actions">
            <button disabled={basket.length === 0}>
              Hold Sale
            </button>
            <button disabled={basket.length === 0}>Discount</button>
          </div>
        </div>
      </section>

      {paymentOpen && (
        <div className="modal-backdrop">
          <div className="payment-modal">
            <div className="modal-header">
              <div>
                <h2>Payment</h2>
                <p>Choose a payment method.</p>
              </div>

              <button
                className="modal-close"
                onClick={() => setPaymentOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="payment-total">
              <span>Total due</span>
              <strong>{money(total)}</strong>
            </div>

            <div className="payment-methods">
              <button onClick={() => completePayment("Cash")}>
                <span className="payment-icon">£</span>
                <strong>Cash</strong>
                <small>Cash payment</small>
              </button>

              <button onClick={() => completePayment("Card")}>
                <span className="payment-icon">
                  <CreditCard size={25} />
                </span>
                <strong>Card</strong>
                <small>Card terminal</small>
              </button>

              <button onClick={() => completePayment("Other")}>
                <span className="payment-icon">
                  <Receipt size={25} />
                </span>
                <strong>Other</strong>
                <small>Other payment</small>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleAdminScreen({
  title,
  icon,
  description,
  columns,
  rows,
}) {
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <div className="heading-with-icon">
            {icon}
            <h1>{title}</h1>
          </div>
          <p>{description}</p>
        </div>

        <button className="primary-button">
          <Plus size={17} />
          Add New
        </button>
      </div>

      <div className="admin-toolbar">
        <div className="search-box admin-search">
          <Search size={18} />
          <input placeholder={`Search ${title.toLowerCase()}...`} />
        </div>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, cellIndex) => (
                  <td key={cellIndex}>
                    {cellIndex === row.length - 1 &&
                    (value === "Low stock" || value === "In stock") ? (
                      <span
                        className={`stock-status ${
                          value === "Low stock" ? "low" : "good"
                        }`}
                      >
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsScreen() {
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <div className="heading-with-icon">
            <BarChart3 size={21} />
            <h1>Reports</h1>
          </div>
          <p>Overview of today's store performance.</p>
        </div>

        <button className="secondary-button">Today ▾</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span>Today's Sales</span>
          <strong>£1,842.50</strong>
          <small>+8.4% vs yesterday</small>
        </div>

        <div className="stat-card">
          <span>Transactions</span>
          <strong>126</strong>
          <small>Average £14.62</small>
        </div>

        <div className="stat-card">
          <span>Items Sold</span>
          <strong>348</strong>
          <small>2.76 items / transaction</small>
        </div>

        <div className="stat-card">
          <span>Refunds</span>
          <strong>£38.00</strong>
          <small>3 transactions</small>
        </div>
      </div>

      <div className="report-card">
        <div className="report-card-header">
          <div>
            <h3>Sales overview</h3>
            <p>Hourly sales performance</p>
          </div>
        </div>

        <div className="fake-chart">
          {[38, 52, 44, 67, 61, 78, 72, 91, 83, 68, 74, 88].map(
            (height, index) => (
              <div className="chart-column" key={index}>
                <div
                  className="chart-bar"
                  style={{ height: `${height}%` }}
                />
                <span>{index + 9}:00</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
