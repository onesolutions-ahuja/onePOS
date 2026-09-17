import React from "react";
import { Link } from "react-router-dom";

function HeroSection() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-container">
        <div className="hero-content">
          <p className="eyebrow">COMPLETE RETAIL MANAGEMENT PLATFORM</p>
          <h1 id="hero-title">Run your entire retail operation from onePOS</h1>
          <p className="lead">
            onePOS connects your sales, inventory, purchasing, customers, suppliers, online orders and business insights in one unified platform. From single stores to multi-location chains.
          </p>
          <div className="hero-badges">
            <span className="hero-badge">✓ Point of Sale</span>
            <span className="hero-badge">✓ Inventory & Stock</span>
            <span className="hero-badge">✓ Purchasing & Suppliers</span>
            <span className="hero-badge">✓ Multi-store Management</span>
            <span className="hero-badge">✓ Online Delivery Integration</span>
            <span className="hero-badge">✓ Business Reports</span>
          </div>
          <div className="hero-actions">
            <Link to="/login" className="button button-primary">
              Log in to onePOS
              <span className="arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/product/pos" className="button button-secondary">
              Explore onePOS
              <span className="arrow" aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="hero-trust">
            <p>Trusted by retail businesses for:</p>
            <div className="trust-items">
              <span>🏪 Multi-store operations</span>
              <span>📦 Stock control</span>
              <span>🚗 Delivery integration</span>
              <span>💬 WhatsApp invoicing</span>
            </div>
          </div>
        </div>
        <div className="hero-visual" aria-label="onePOS workspace visualization">
          <div className="visual-container">
            <div className="visual-header">
              <span className="live-dot"></span>
              <span>ONEPOS DASHBOARD</span>
              <span className="demo-badge">LIVE PREVIEW</span>
            </div>
            <div className="visual-body">
              <div className="metric-card primary">
                <p>Today's Performance</p>
                <strong>Real-time business overview</strong>
                <div className="metrics">
                  <div className="metric">
                    <b>£2,847</b>
                    <small>Today's Sales</small>
                  </div>
                  <div className="metric">
                    <b>142</b>
                    <small>Transactions</small>
                  </div>
                  <div className="metric">
                    <b>£20.05</b>
                    <small>Average Sale</small>
                  </div>
                  <div className="metric">
                    <b>8</b>
                    <small>Online Orders</small>
                  </div>
                </div>
              </div>
              <div className="metric-card secondary">
                <p>Quick Actions</p>
                <div className="operation-list">
                  <span>New Sale <b>→</b></span>
                  <span>Add Product <b>→</b></span>
                  <span>Receive Stock <b>→</b></span>
                  <span>View Reports <b>→</b></span>
                  <span>Process Online Orders <b>→</b></span>
                </div>
              </div>
            </div>
            <p className="visual-caption">
              Complete visibility across your retail operation with onePOS
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;