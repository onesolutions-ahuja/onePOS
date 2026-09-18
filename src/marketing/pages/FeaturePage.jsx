import React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, Icon } from "../components/Ui";
import productData from "../data/productData";

const FALLBACK = {
  title: "Feature page",
  category: "onePOS platform",
  tagline: "Part of the onePOS platform.",
  summary: "This feature is part of the onePOS platform.",
};

export default function FeaturePage({ feature: featureProp }) {
  const params = useParams();
  const feature = featureProp || params.feature;
  const product = productData[feature] || FALLBACK;

  usePageMeta({
    title: `onePOS | ${product.title}`,
    description: product.summary,
  });

  if (!productData[feature]) {
    return (
      <div className="page">
        <PageHero
          crumbs={[{ label: "Home", to: "/" }, { label: "Features" }]}
          eyebrow="Features"
          title="Feature not found"
          lead="That feature page doesn't exist — start from the platform overview instead."
        >
          <Btn to="/pos" variant="primary">Explore onePOS</Btn>
        </PageHero>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: product.category, to: "/platforms" }, { label: product.title }]}
        eyebrow={product.category}
        title={product.tagline}
        lead={product.summary}
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/multi-store" variant="secondary">Business management</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <div className="int-summary">
            <span className="icon-tile icon-tile--lg"><Icon name={product.icon} size={26} /></span>
            <div>
              <h2>{product.highlight}</h2>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow={`${product.title} capabilities`} title="What's inside" />
          <div className="feature-grid feature-grid--3">
            {product.features.map((f) => (
              <div className="feature-card feature-card--static" key={f}>
                <span className="check-tick check-tick--static" aria-hidden="true">✓</span>
                <p>{f}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Why it matters" title="The business impact" />
          <div className="pillar-grid">
            {product.benefits.map((b) => (
              <div className="pillar-card" key={b.title}>
                <span className="pillar-icon pillar-icon--teal"><Icon name={product.icon} size={18} /></span>
                <h3>{b.title}</h3>
                <p>{b.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="Related" title="Keep exploring" />
          <div className="related-grid">
            {product.related.map((r) => (
              <Link to={r.to} className="related-card" key={r.to}>
                <div>
                  <h4>{r.label}</h4>
                  <p>{r.note}</p>
                </div>
                <ArrowRight size={14} className="related-arrow" />
              </Link>
            ))}
            <Link to="/ecosystem" className="related-card">
              <div>
                <h4>The onePOS ecosystem</h4>
                <p>Channels, add-ons and connections around the core.</p>
              </div>
              <ArrowRight size={14} className="related-arrow" />
            </Link>
          </div>
        </div>
      </section>

      <CTASection
        title={`Put ${product.title.toLowerCase()} on one system`}
        lead="Log in to your onePOS workspace to explore it live — or read another feature page first."
      />
    </div>
  );
}