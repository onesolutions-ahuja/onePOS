import React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Image as ImageIcon } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead } from "../components/Ui";
import { getArticlesForCategory, getCategory } from "../data/helpContent";

export default function HelpCategoryPage() {
  const { category: slug } = useParams();
  const category = getCategory(slug);
  const articles = getArticlesForCategory(slug);
  const visualGuides = slug === "visual-guides";

  usePageMeta({
    title: category ? `onePOS Help | ${category.label}` : "onePOS Help Centre",
    description: category?.description,
  });

  if (!category) return null;

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Help Centre", to: "/help" }, { label: category.label }]}
        eyebrow={category.eyebrow}
        title={category.title}
        lead={category.description}
      />
      <section className="section section--flush">
        <div className="wrap">
          <SectionHead eyebrow={visualGuides ? "Visual guide template" : `${articles.length} guides`} title={visualGuides ? "Screenshot-ready documentation" : "Choose a guide"} lead={visualGuides ? "These layouts are ready for real onePOS screenshots and annotations to be added later. No application screenshots are invented here." : "Each guide is designed to be read at the till: short steps, clear checks and an escalation point when the normal fix does not work."} />
          {visualGuides ? (
            <div className="visual-placeholder-grid">
              {["Creating a sale", "Taking a payment", "Checking stock"].map((label) => (
                <div className="visual-placeholder-card" key={label}>
                  <div className="visual-placeholder"><ImageIcon size={26} /><span>Screenshot placeholder</span></div>
                  <h3>{label}</h3><p>Replace this placeholder with an approved product screenshot and caption when available.</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="help-article-list">
              {articles.map((article) => (
                <Link className="help-article-card" to={`/help/article/${article.slug}`} key={article.slug}>
                  <div><span className="help-article-meta">{article.readTime} read · {article.tags?.join(" · ")}</span><h3>{article.title}</h3><p>{article.summary}</p></div>
                  <ArrowRight size={18} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="section section--soft">
        <div className="wrap">
          <Link className="back-help-link" to="/help">← Back to Help Centre</Link>
        </div>
      </section>
    </div>
  );
}
