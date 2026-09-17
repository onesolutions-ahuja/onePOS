import React from "react";
import { Link } from "react-router-dom";

function FeatureGrid() {
  const features = [
    {
      title: "Point of Sale",
      description: "A focused point-of-sale workspace for sales, payments, receipts and day-to-day till activity.",
      icon: "🖥️",
      path: "/product/pos",
    },
    {
      title: "Inventory",
      description: "Keep products, categories, stock movements, adjustments and reconciliation in view.",
      icon: "📦",
      path: "/product/inventory",
    },
    {
      title: "Purchasing",
      description: "Manage suppliers, purchase records and receiving alongside your stock workflow.",
      icon: "🛒",
      path: "/product/purchasing",
    },
    {
      title: "Customers",
      description: "Maintain customer records and connect them to sales activity when it matters.",
      icon: "👥",
      path: "/product/customers",
    },
    {
      title: "Teams & Permissions",
      description: "Give people access through roles and granular permissions designed for retail operations.",
      icon: "👤",
      path: "/product/employees",
    },
    {
      title: "Multi-store",
      description: "Bring store-level operations into a company-aware system built around stores and terminals.",
      icon: "🏪",
      path: "/product/multi-store",
    },
    {
      title: "Reports",
      description: "Review sales, payments, VAT, inventory, customer and product reporting from one place.",
      icon: "📊",
      path: "/product/reports",
    },
    {
      title: "Online Orders",
      description: "Bring online-order preparation into the operational flow with delivery platform integration.",
      icon: "📱",
      path: "/online-delivery",
    },
  ];

  return (
    <section className="section feature-section" aria-labelledby="features-title">
      <div className="section-container">
        <div className="section-heading">
          <p className="eyebrow">ONE PLATFORM, EVERYDAY CLARITY</p>
          <h2 id="features-title">Run the essentials with less switching and more control.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <Link key={feature.title} to={feature.path} className="feature-card">
              <span className="feature-number">0{index + 1}</span>
              <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <span className="feature-link">
                Learn more
                <span className="arrow" aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default FeatureGrid;