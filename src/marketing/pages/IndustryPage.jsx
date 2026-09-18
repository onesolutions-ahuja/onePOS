import React from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, Btn, CTASection } from "../components/Ui";
import industryData from "../data/industryData";

const SECTORS = Object.keys(industryData);

export default function IndustryPage() {
  const { sector } = useParams();
  const industry = sector ? industryData[sector] : null;

  usePageMeta(
    industry
      ? { title: `onePOS | ${industry.title} — industry solution`, description: industry.description }
      : { title: "onePOS | Industry solutions", description: "onePOS industry solutions: retail, convenience stores, off-licence, grocery and multi-store retail." }
  );

  if (!sector) return <Navigate to="/industry/retail" replace />;

  if (!industry) {
    return (
      <div className="page">
        <PageHero
          crumbs={[{ label: "Home", to: "/" }, { label: "Industries" }]}
          eyebrow="Industries"
          title="Industry not found"
          lead="That industry page doesn't exist — browse the list instead."
        >
          <Btn to="/industry/retail" variant="primary">View Retail Solutions</Btn>
        </PageHero>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Industries", to: "/industry/retail" }, { label: industry.title }]}
        eyebrow="Industry solution"
        title={`onePOS for ${industry.title}`}
        lead={industry.description}
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/pos" variant="secondary">The till</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <div className="int-summary">
            <div>
              <h2>{industry.overview}</h2>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="The challenges" title="What this sector deals with" />
            <div className="challenge-list">
              {industry.challenges.map((c, i) => (
                <div className="challenge-item" key={i}>
                  <span className="challenge-num">{String(i + 1).padStart(2, "0")}</span>
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>How onePOS helps</h4>
              <div className="mini-cards">
                {industry.solutions.map((s) => (
                  <div className="mini-card" key={s.title}>
                    <span className="mini-check">✓</span>
                    <div>
                      <b>{s.title}</b>
                      <p>{s.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Feature set" title={`Key features for ${industry.title}`} />
          <div className="feature-grid feature-grid--3">
            {industry.features.map((f) => (
              <div className="feature-card feature-card--static" key={f}>
                <span className="check-tick check-tick--static" aria-hidden="true">✓</span>
                <p>{f}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="Industries" title="Other sectors we cover" />
          <div className="related-grid">
            {SECTORS.filter((s) => s !== sector).map((s) => {
              const ind = industryData[s];
              return (
                <Link to={`/industry/${s}`} className="related-card" key={s}>
                  <div>
                    <h4>{ind.title}</h4>
                    <p>{ind.description}</p>
                  </div>
                  <ArrowRight size={14} className="related-arrow" />
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <CTASection
        title={`See onePOS working for ${industry.title}`}
        lead="Log in to your onePOS workspace — or explore the till, inventory and reports first."
      />
    </div>
  );
}