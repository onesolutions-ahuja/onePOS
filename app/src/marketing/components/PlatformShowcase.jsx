import React from "react";
import { Link } from "react-router-dom";

function PlatformShowcase() {
  const platforms = [
    {
      name: "Windows",
      icon: "💻",
      description: "Full-featured Windows POS",
      path: "/platform/windows",
      color: "#0078D4",
    },
    {
      name: "Android",
      icon: "📱",
      description: "Flexible tablet POS",
      path: "/platform/android",
      color: "#3DDC84",
    },
    {
      name: "iPad",
      icon: "📲",
      description: "Premium iPad experience",
      path: "/platform/ios",
      color: "#000000",
    },
    {
      name: "Web",
      icon: "🌐",
      description: "Browser-based access",
      path: "/platform/web",
      color: "#4285F4",
    },
  ];

  return (
    <section className="section platform-showcase" aria-labelledby="platform-title">
      <div className="section-container">
        <div className="section-heading">
          <p className="eyebrow">RUN ANYWHERE</p>
          <h2 id="platform-title">Your business, your platform choice</h2>
          <p>
            onePOS runs on Windows, Android, iPad, and web browsers. Choose the platform that fits your business and hardware setup.
          </p>
        </div>
        <div className="platform-grid">
          {platforms.map((platform) => (
            <Link key={platform.name} to={platform.path} className="platform-card">
              <div 
                className="platform-icon-wrapper" 
                style={{ backgroundColor: `${platform.color}15` }}
              >
                <span className="platform-icon" aria-hidden="true">{platform.icon}</span>
              </div>
              <h3>{platform.name}</h3>
              <p>{platform.description}</p>
              <span className="platform-link">
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

export default PlatformShowcase;