import React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Image as ImageIcon } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead } from "../components/Ui";
import { HELP_ARTICLES_BY_SLUG, getCategory } from "../data/helpContent";

export default function HelpArticlePage() {
  const { slug } = useParams();
  const article = HELP_ARTICLES_BY_SLUG[slug];
  const category = article && getCategory(article.category);
  const related = article?.related?.map((item) => HELP_ARTICLES_BY_SLUG[item]).filter(Boolean) || [];

  usePageMeta({
    title: article ? `onePOS Help | ${article.title}` : "onePOS Help Centre",
    description: article?.summary,
  });

  if (!article || !category) return null;

  return (
    <div className="page help-article-page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Help Centre", to: "/help" }, { label: category.label, to: `/help/${category.slug}` }, { label: article.title }]}
        eyebrow={`${category.label} · ${article.readTime} read`}
        title={article.title}
        lead={article.summary}
      >
        <div className="chip-row">{article.tags?.map((tag) => <span className="chip-chip" key={tag}>{tag}</span>)}</div>
      </PageHero>
      <section className="section section--flush">
        <div className="wrap help-article-layout">
          <article className="help-article-content">
            {article.screenshot && <figure className="article-screenshot-placeholder"><ImageIcon size={24} /><span>Screenshot placeholder</span><figcaption>{article.screenshot}. Replace this placeholder with an approved onePOS screenshot and annotated caption.</figcaption></figure>}
            {article.sections.map((section, index) => (
              <section className="help-article-section" key={section.heading}>
                <div className="help-step-heading"><span>{String(index + 1).padStart(2, "0")}</span><h2>{section.heading}</h2></div>
                {section.steps && <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                {section.body && <p>{section.body}</p>}
              </section>
            ))}
            <div className="help-escalation-card help-escalation-card--article">
              <h3>If this does not solve the problem</h3>
              <p>Share the store, till, time, exact message and steps already tried with your manager or support contact. Do not share passwords or full card numbers.</p>
            </div>
          </article>
          <aside className="help-article-aside">
            <Link className="back-help-link" to={`/help/${category.slug}`}>← {category.label}</Link>
            <div className="help-aside-note"><strong>Help Centre</strong><p>Need another guide? Browse the category or return to the Help Centre.</p><Link className="text-link" to="/help">All help articles <ArrowRight size={14} /></Link></div>
          </aside>
        </div>
      </section>
      {related.length > 0 && (
        <section className="section section--soft">
          <div className="wrap">
            <SectionHead eyebrow="Keep learning" title="Related articles" />
            <div className="related-help-grid">{related.map((item) => <Link className="help-related-card" to={`/help/article/${item.slug}`} key={item.slug}><span>{item.category === "troubleshooting" ? "Troubleshooting" : getCategory(item.category)?.label}</span><h3>{item.title}</h3><ArrowRight size={15} /></Link>)}</div>
          </div>
        </section>
      )}
    </div>
  );
}
