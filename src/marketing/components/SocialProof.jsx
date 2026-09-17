import React from "react";

function SocialProof() {
  const trustIndicators = [
    {
      icon: "🔒",
      title: "Secure",
      description: "Bank-level security for your data",
    },
    {
      icon: "⚡",
      title: "Fast",
      description: "Optimized for speed and reliability",
    },
    {
      icon: "🌍",
      title: "Reliable",
      description: "99.9% uptime for business continuity",
    },
    {
      icon: "🛡️",
      title: "Protected",
      description: "GDPR compliant data protection",
    },
  ];

  return (
    <section className="section social-proof" aria-labelledby="trust-title">
      <div className="section-container">
        <div className="section-heading" style={{ textAlign: "center", maxWidth: "700px", margin: "0 auto 60px" }}>
          <p className="eyebrow">TRUSTED BY RETAILERS</p>
          <h2 id="trust-title">Built for businesses that demand reliability</h2>
          <p>
            onePOS is designed with enterprise-grade security, performance, and reliability at its core.
          </p>
        </div>
        <div className="trust-grid">
          {trustIndicators.map((indicator) => (
            <div key={indicator.title} className="trust-card">
              <span className="trust-icon" aria-hidden="true">{indicator.icon}</span>
              <h3>{indicator.title}</h3>
              <p>{indicator.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default SocialProof;