import React from "react";
import { Link } from "react-router-dom";

function IntegrationPreview() {
  const integrations = [
    {
      title: "WhatsApp",
      tag: "COMMUNICATION",
      description: "Send invoices and communicate with customers through WhatsApp with secure links and PDF attachments.",
      icon: "💬",
    },
    {
      title: "Delivery Platforms",
      tag: "ONLINE ORDERS",
      description: "Integrate Uber Eats, Deliveroo, and Just Eat for unified delivery order management.",
      icon: "🚗",
    },
    {
      title: "Shopify",
      tag: "E-COMMERCE",
      description: "Connect your Shopify store for unified product and order management across channels.",
      icon: "🛍️",
    },
    {
      title: "Accounting",
      tag: "FINANCE",
      description: "Automate financial data flow between onePOS and your accounting software.",
      icon: "📊",
    },
    {
      title: "API & Integrations",
      tag: "CUSTOM",
      description: "Build custom integrations with flexible API endpoints and secure authentication.",
      icon: "🔗",
    },
    {
      title: "Offline POS",
      tag: "RELIABILITY",
      description: "Continue selling even without internet connection with automatic data synchronization.",
      icon: "🔄",
    },
  ];

  return (
    <section className="section integration-section" aria-labelledby="integration-title">
      <div className="section-container">
        <div className="section-heading">
          <p className="eyebrow">CONNECTED BY DESIGN</p>
          <h2 id="integration-title">Keep customer-facing work and operational information moving together.</h2>
        </div>
        <div className="integration-grid">
          {integrations.map((integration) => (
            <article key={integration.title} className="integration-card">
              <span className="integration-tag">{integration.tag}</span>
              <span className="integration-icon" aria-hidden="true">{integration.icon}</span>
              <h3>{integration.title}</h3>
              <p>{integration.description}</p>
            </article>
          ))}
        </div>
        <div className="integration-cta">
          <Link to="/integrations" className="button button-secondary">
            Explore all integrations
            <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default IntegrationPreview;