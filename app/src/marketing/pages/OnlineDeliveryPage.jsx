import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import VisualFlow from "../components/VisualFlow";

function OnlineDeliveryPage() {
  useEffect(() => {
    document.title = "onePOS | Online Orders & Delivery Integration";
  }, []);
  const platforms = [
    {
      name: "Uber Eats",
      icon: "🚗",
      description: "Direct order reception and management",
      link: "/integrations/uber-eats",
    },
    {
      name: "Deliveroo",
      icon: "🥡",
      description: "Webhook-based order processing",
      link: "/integrations/deliveroo",
    },
    {
      name: "Just Eat",
      icon: "🍔",
      description: "Seamless order integration",
      link: "/integrations/just-eat",
    },
  ];

  const features = [
    {
      title: "Centralized Order Management",
      description: "Receive and manage delivery orders from multiple platforms in one unified interface.",
      icon: "📱",
    },
    {
      title: "Kitchen Display",
      description: "Dedicated preparation view for online orders with status tracking and timing.",
      icon: "👨‍🍳",
    },
    {
      title: "Inventory Integration",
      description: "Automatic stock updates when online orders are processed across all channels.",
      icon: "📦",
    },
    {
      title: "Real-time Status Updates",
      description: "Send order status updates back to delivery platforms for customer transparency.",
      icon: "🔄",
    },
    {
      title: "Menu Synchronization",
      description: "Keep your menu consistent across onePOS and all delivery platforms.",
      icon: "🍽️",
    },
    {
      title: "Unified Reporting",
      description: "Consolidated reporting across in-store and online sales channels.",
      icon: "📊",
    },
  ];

  return (
    <div className="page-container">
      <section className="page-header" aria-labelledby="online-delivery-title">
        <div className="section-container">
          <Link to="/" className="breadcrumb">
            Home
            <span className="separator" aria-hidden="true">/</span>
            Online Orders
          </Link>
          <p className="eyebrow">ONLINE & DELIVERY</p>
          <h1 id="online-delivery-title">Online Orders & Delivery Platform Integration</h1>
          <p className="lead">
            Bring online order preparation into your operational flow with platform configuration for major delivery services.
          </p>
        </div>
      </section>

      <section className="platform-overview">
        <div className="section-container">
          <h2>Supported Delivery Platforms</h2>
          <div className="platform-grid">
            {platforms.map((platform) => (
              <Link key={platform.name} to={platform.link} className="platform-card">
                <span className="platform-icon" aria-hidden="true">{platform.icon}</span>
                <h3>{platform.name}</h3>
                <p>{platform.description}</p>
                <span className="platform-link">
                  View integration
                  <span className="arrow" aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="online-features">
        <div className="section-container">
          <h2>Online Order Management Features</h2>
          <div className="features-grid">
            {features.map((feature) => (
              <div key={feature.title} className="feature-item">
                <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="online-workflow">
        <div className="section-container">
          <div className="workflow-layout">
            <div className="workflow-content">
              <h2>How It Works</h2>
              <div className="workflow-steps">
                <div className="workflow-step">
                  <span className="step-number">1</span>
                  <div className="step-content">
                    <h3>Order Received</h3>
                    <p>Delivery platform sends order to onePOS via webhook or API integration.</p>
                  </div>
                </div>
                <div className="workflow-step">
                  <span className="step-number">2</span>
                  <div className="step-content">
                    <h3>Order Processing</h3>
                    <p>Order appears in dedicated online orders interface for kitchen preparation.</p>
                  </div>
                </div>
                <div className="workflow-step">
                  <span className="step-number">3</span>
                  <div className="step-content">
                    <h3>Inventory Update</h3>
                    <p>Stock levels are automatically adjusted as items are prepared and completed.</p>
                  </div>
                </div>
                <div className="workflow-step">
                  <span className="step-number">4</span>
                  <div className="step-content">
                    <h3>Status Sync</h3>
                    <p>Order status updates are sent back to the delivery platform in real-time.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="workflow-visual">
              <VisualFlow type="uber-eats" />
            </div>
          </div>
        </div>
      </section>

      <section className="online-cta">
        <div className="section-container">
          <div className="cta-content">
            <h2>Ready to streamline your delivery operations?</h2>
            <p>Configure delivery platform integrations from your onePOS settings.</p>
            <a href="/login" className="button button-primary">
              Login to onePOS
              <span className="arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default OnlineDeliveryPage;