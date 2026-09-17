import React from "react";
import { Link } from "react-router-dom";

function CTASection() {
  return (
    <section className="section cta-section" aria-labelledby="cta-title">
      <div className="section-container">
        <div className="cta-content">
          <p className="eyebrow">YOUR ONEPOS WORKSPACE</p>
          <h2 id="cta-title">Ready to get back to running the shop?</h2>
          <Link to="/login" className="button button-primary button-light">
            Login to onePOS
            <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default CTASection;