import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { BrandMark } from "./Ui";

const NAV_ITEMS = [
  { label: "POS", to: "/pos" },
  {
    label: "Product",
    dropdown: [
      { label: "Inventory", to: "/inventory" },
      { label: "Purchasing", to: "/purchasing" },
      { label: "Customers", to: "/customers" },
      { label: "Employees & Permissions", to: "/employees" },
      { label: "Multi-store", to: "/multi-store" },
      { label: "Reports", to: "/reports" },
    ],
  },
  { label: "Online Orders", to: "/online-orders" },
  {
    label: "Integrations",
    dropdown: [
      { label: "WhatsApp invoicing", to: "/whatsapp" },
      { label: "Uber Eats", to: "/integrations/uber-eats" },
      { label: "Deliveroo", to: "/integrations/deliveroo" },
      { label: "Just Eat", to: "/integrations/just-eat" },
      { label: "Shopify", to: "/integrations/shopify" },
      { label: "Accounting", to: "/integrations/accounting" },
      { label: "API & Integrations", to: "/integrations/api" },
    ],
  },
  {
    label: "Platforms",
    dropdown: [
      { label: "Web Browser", to: "/platform/web" },
      { label: "Windows", to: "/platform/windows" },
      { label: "Android", to: "/platform/android" },
      { label: "iPad", to: "/platform/ios" },
      { label: "Offline & Connectivity", to: "/platforms" },
    ],
  },
  { label: "Hardware", to: "/hardware" },
  {
    label: "Resources",
    dropdown: [
      { label: "Help & Support", to: "/help" },
      { label: "Security & Control", to: "/security" },
      { label: "onePOS Ecosystem", to: "/ecosystem" },
      { label: "Hardware guide", to: "/hardware" },
      { label: "FAQ", to: "/faq" },
    ],
  },
];

function isActive(path, item, location) {
  if (item.to) return location.pathname === item.to;
  if (item.dropdown) return item.dropdown.some((d) => location.pathname === d.to);
  return false;
}

export default function Navigation({ mobileMenuOpen, setMobileMenuOpen }) {
  const location = useLocation();
  const [openDropdown, setOpenDropdown] = useState(null);
  const closeTimer = useRef(null);

  // Close menus on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenDropdown(null);
  }, [location.pathname, setMobileMenuOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const onDocClick = () => setOpenDropdown(null);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const enterDropdown = (label) => {
    clearTimeout(closeTimer.current);
    setOpenDropdown(label);
  };
  const leaveDropdown = (label) => {
    closeTimer.current = setTimeout(() => {
      setOpenDropdown((cur) => (cur === label ? null : cur));
    }, 140);
  };

  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <Link to="/" className="brand" aria-label="onePOS home">
          <BrandMark />
          <span>onePOS</span>
        </Link>

        <nav className="desktop-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              className={`nav-item ${isActive(item.to ? item.to : null, item, location) ? "is-active" : ""}`}
              onMouseEnter={() => item.dropdown && enterDropdown(item.label)}
              onMouseLeave={() => item.dropdown && leaveDropdown(item.label)}
            >
              {item.dropdown ? (
                <>
                  <button
                    type="button"
                    className="nav-link"
                    aria-expanded={openDropdown === item.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === item.label ? null : item.label);
                    }}
                  >
                    {item.label}
                    <ChevronDown size={14} className="nav-chevron" />
                  </button>
                  <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                    {item.dropdown.map((sub) => (
                      <Link key={sub.to} to={sub.to} className="dropdown-item">
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <Link to={item.to} className="nav-link">
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </nav>

        <div className="header-actions">
          <a href="/login" className="btn btn-primary btn-sm">
            Log in
          </a>
          <button
            type="button"
            className={`mobile-toggle ${mobileMenuOpen ? "is-open" : ""}`}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav className="mobile-nav" aria-label="Mobile">
          {NAV_ITEMS.map((item) => (
            <div key={item.label} className="mobile-nav-item">
              {item.dropdown ? (
                <>
                  <button
                    type="button"
                    className="mobile-nav-label"
                    onClick={() => setOpenDropdown(openDropdown === item.label ? null : item.label)}
                    aria-expanded={openDropdown === item.label}
                  >
                    {item.label}
                    <ChevronDown size={14} className={openDropdown === item.label ? "rotated" : ""} />
                  </button>
                  {openDropdown === item.label && (
                    <div className="mobile-sub">
                      {item.dropdown.map((sub) => (
                        <Link key={sub.to} to={sub.to} className="mobile-sub-link">
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Link to={item.to} className="mobile-nav-label">
                  {item.label}
                </Link>
              )}
            </div>
          ))}
          <a href="/login" className="btn btn-primary mobile-cta">
            Log in to onePOS
          </a>
        </nav>
      )}
    </header>
  );
}