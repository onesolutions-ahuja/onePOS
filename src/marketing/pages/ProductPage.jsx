import React, { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import productData from "../data/productData";
import VisualFlow from "../components/VisualFlow";

function ProductPage() {
  const { feature } = useParams();
  const product = productData[feature];

  useEffect(() => {
    if (product) {
      document.title = `onePOS | ${product.title}`;
    }
  }, [product]);

  if (!product) {
    return (
      <div className="page-container">
        <div className="error-section">
          <h1>Product feature not found</h1>
          <Link to="/product/pos" className="button button-secondary">
            View Point of Sale
          </Link>
        </div>
      </div>
    );
  }

  const getVisualFlow = (feature) => {
    const flowMap = {
      offline: "offline",
    };
    return flowMap[feature] || null;
  };

  return (
    <div className="page-container">
      <section className="product-detail-header" aria-labelledby="product-title">
        <div className="section-container">
          <Link to="/" className="breadcrumb">
            Home
            <span className="separator" aria-hidden="true">/</span>
            Product
          </Link>
          <p className="eyebrow">{product.category}</p>
          <h1 id="product-title">{product.title}</h1>
          <p className="lead">{product.description}</p>
        </div>
      </section>

      <section className="product-detail-content">
        <div className="section-container">
          <div className="product-layout">
            <div className="product-main">
              <div className="product-visual">
                <div className="screenshot-placeholder">
                  <span className="placeholder-icon">{product.icon}</span>
                  <p>Screenshot coming soon</p>
                  <small>Real onePOS {product.title} interface will be displayed here</small>
                </div>
              </div>

              {getVisualFlow(feature) && (
                <div className="product-visual-flow">
                  <VisualFlow type={getVisualFlow(feature)} />
                </div>
              )}

              <div className="product-features">
                <h2>Key Features</h2>
                <ul>
                  {product.features.map((feature, index) => (
                    <li key={index}>
                      <span className="feature-bullet" aria-hidden="true">✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {product.benefits && (
                <div className="product-benefits">
                  <h2>Benefits</h2>
                  <div className="benefits-grid">
                    {product.benefits.map((benefit, index) => (
                      <div key={index} className="benefit-card">
                        <h3>{benefit.title}</h3>
                        <p>{benefit.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="product-sidebar">
              <div className="sidebar-card">
                <h3>Quick Links</h3>
                <nav className="sidebar-nav">
                  <Link to="/product/pos">Point of Sale</Link>
                  <Link to="/product/inventory">Inventory</Link>
                  <Link to="/product/purchasing">Purchasing</Link>
                  <Link to="/product/customers">Customers</Link>
                  <Link to="/product/employees">Employees & Permissions</Link>
                  <Link to="/product/multi-store">Multi-store Management</Link>
                  <Link to="/product/reports">Reports</Link>
                  <Link to="/product/offline">Offline POS</Link>
                </nav>
              </div>

              <div className="sidebar-card cta-card">
                <h3>Ready to get started?</h3>
                <p>Log in to your onePOS workspace to explore these features.</p>
                <Link to="/login" className="button button-primary">
                  Login to onePOS
                  <span className="arrow" aria-hidden="true">→</span>
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="product-related">
        <div className="section-container">
          <h2>Related Features</h2>
          <div className="related-grid">
            {product.related?.map((related) => (
              <Link key={related.path} to={related.path} className="related-card">
                <span className="related-icon" aria-hidden="true">{related.icon}</span>
                <h3>{related.title}</h3>
                <p>{related.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default ProductPage;