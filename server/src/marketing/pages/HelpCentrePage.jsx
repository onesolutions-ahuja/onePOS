import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search, LifeBuoy, Mail } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, Btn } from "../components/Ui";
import { HelpIcon } from "../components/HelpIcons";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../data/helpContent";

export default function HelpCentrePage() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    return HELP_ARTICLES.filter((article) =>
      [article.title, article.summary, ...(article.tags || [])].join(" ").toLowerCase().includes(value)
    ).slice(0, 7);
  }, [query]);

  usePageMeta({
    title: "onePOS Help Centre | Support, tutorials & training",
    description: "Practical onePOS help: getting started, tutorials, troubleshooting, staff training, product guides and visual documentation.",
  });

  return (
    <div className="page help-centre">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Help Centre" }]}
        eyebrow="Help & Support"
        title="A clear answer for every shift"
        lead="Find practical instructions for using onePOS, solving common till problems and training your team. This help centre is the central documentation source for your store."
      >
        <div className="help-search" role="search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the help centre"
            aria-label="Search the help centre"
          />
        </div>
        {query && (
          <div className="help-search-results">
            {results.length ? results.map((article) => (
              <Link key={article.slug} to={`/help/article/${article.slug}`}>
                <span>{article.title}</span><ArrowRight size={14} />
              </Link>
            )) : <p>No matching articles yet. Try a product, task or problem.</p>}
          </div>
        )}
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <SectionHead eyebrow="Browse support" title="What do you need help with?" lead="Start with a category, then choose the article that matches the job in front of you." />
          <div className="help-category-grid">
            {HELP_CATEGORIES.map((category) => (
              <Link className="help-category-card" to={`/help/${category.slug}`} key={category.slug}>
                <span className="help-icon-tile"><HelpIcon name={category.icon} /></span>
                <div>
                  <h3>{category.label}</h3>
                  <p>{category.description}</p>
                </div>
                <span className="feature-link">Browse guides <ArrowRight size={14} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap help-support-grid">
          <div>
            <SectionHead eyebrow="In-app help" title="Help is always one click away" lead="When a colleague is using onePOS, point them to this Help Centre from the website or an in-app help link. Articles are written as standalone guides so they can be linked contextually from the right screen in future." />
            <div className="inline-actions">
              <Btn to="/help/getting-started" variant="secondary">Start with the basics</Btn>
              <Btn to="/help/troubleshooting" variant="ghost">Fix a problem</Btn>
            </div>
          </div>
          <div className="help-escalation-card">
            <LifeBuoy size={22} />
            <h3>Still need a hand?</h3>
            <p>Tell your manager or support contact the store, till, time, exact message and steps already tried. Never send passwords or full card numbers.</p>
            <Link className="text-link" to="/help#contact">Get support <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      <section className="section" id="contact">
        <div className="wrap">
          <SectionHead eyebrow="Contact / Get support" title="Make support easy to resolve" lead="Use your agreed store support route or contact your onePOS representative. Include useful context so the right person can help quickly." />
          <div className="help-contact-grid">
            <div className="help-contact-card"><Mail size={20} /><div><h3>What to include</h3><p>Store and till, date and time, affected sale or product, exact error message, what you expected and what you already tried.</p></div></div>
            <div className="help-contact-card"><LifeBuoy size={20} /><div><h3>Keep work moving</h3><p>If trading is blocked, tell the manager first and follow your store's approved offline, payment and refund process.</p></div></div>
          </div>
        </div>
      </section>
    </div>
  );
}
