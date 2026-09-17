import React from "react";
import { Link } from "react-router-dom";

function ValueProposition() {
  const operations = [
    {
      title: "Multi-store Management",
      description: "Bring store-level operations into a company-aware system built around stores, terminals and teams.",
      icon: "🏪",
    },
    {
      title: "Online Orders",
      description: "Bring online-order preparation into the operational flow, with platform configuration foundations for Uber Eats and Deliveroo.",
      icon: "📱",
    },
    {
      title: "Accounting & APIs",
      description: "Manage accounting connections and configurable integration endpoints without exposing credentials in the interface.",
      icon: "🔗",
    },
    {
      title: "Built for Continuity",
      description: "Offline storage and queue foundations help the till retain essential operational context when connectivity drops.",
      icon: "🔄",
    },
  ];

  return (
    <section className="section value-section" aria-labelledby="value-title">
      <div className="section-container split-layout">
        <div className="value-content">
          <p className="eyebrow">BEYOND THE COUNTER</p>
          <h2 id="value-title">One operational view, from each store to the wider business.</h2>
          <p>
            onePOS is structured for the details behind the sale: stock arriving, teams working, orders progressing and decisions being made from useful information.
          </p>
          <Link to="/login" className="text-link">
            Go to login
            <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="operation-list">
          {operations.map((operation) => (
            <article key={operation.title} className="operation-card">
              <span className="operation-icon" aria-hidden="true">{operation.icon}</span>
              <div className="operation-content">
                <h3>{operation.title}</h3>
                <p>{operation.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default ValueProposition;