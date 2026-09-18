import React from "react";

function CTASection() {
  return (
    <section className="section cta-section" aria-labelledby="cta-title">
      <div className="section-container">
        <div className="cta-content">
          <p className="eyebrow">YOUR ONEPOS WORKSPACE</p>
          <h2 id="cta-title">Ready to get back to running the shop?</h2>
          <a href="/login" className="button button-primary button-light">
            Login to onePOS
            <span className="arrow" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

export default CTASection;