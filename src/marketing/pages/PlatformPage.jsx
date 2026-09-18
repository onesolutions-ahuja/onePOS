import React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Monitor, Smartphone, Tablet, Globe, BatteryCharging } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, Icon } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import platformData from "../data/platformData";

const ORDER = ["web", "windows", "android", "ios"];
const DEVICE_ICON = { web: Globe, windows: Monitor, android: Smartphone, ios: Tablet };

export default function PlatformPage() {
  const { platform: platformKey } = useParams();
  const platform = platformKey ? platformData[platformKey] : null;

  usePageMeta(
    platform
      ? { title: `onePOS | ${platform.name} — platform page`, description: platform.summary }
      : {
          title: "onePOS | Platforms & offline",
          description: "onePOS runs in any modern browser — on Windows, Android tablets and iPad — with offline storage and a sync queue.",
        }
  );

  if (!platform) {
    return (
      <div className="page">
        <PageHero
          crumbs={[{ label: "Home", to: "/" }, { label: "Platforms" }]}
          eyebrow="Platforms"
          title="Platform not found"
          lead="That platform page doesn't exist — see the full list instead."
        >
          <Btn to="/platforms" variant="primary">All platforms</Btn>
        </PageHero>
      </div>
    );
  }

  const DeviceIcon = DEVICE_ICON[platformKey] || Globe;
  const related = ORDER.filter((slug) => slug !== platformKey);
  const isBrand = ["windows", "android", "ios"].includes(platformKey);

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Platforms", to: "/platforms" }, { label: platform.name }]}
        eyebrow="Platform"
        title={`Run onePOS on ${platform.name}`}
        lead={platform.summary}
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/hardware" variant="secondary">Hardware guide</Btn>
        </div>
        {isBrand && (
          <div className="hero-brand-note">
            <span className="brand-note-icon"><BrandIcon name={platformKey} /></span>
            {platformKey === "windows" && "Microsoft Windows is a trademark of Microsoft Corporation — shown to identify device compatibility only."}
            {platformKey === "android" && "Android is a trademark of Google LLC — shown to identify device compatibility only."}
            {platformKey === "ios" && "Apple and iPad are trademarks of Apple Inc. — shown to identify device compatibility only."}
          </div>
        )}
      </PageHero>

      <section className="section section--flush">
        <div className="wrap split-section">
          <div className="split-copy">
            <span className="device-icon device-icon--lg">
              {isBrand ? <BrandIcon name={platformKey} /> : <DeviceIcon size={30} />}
            </span>
            <SectionHead eyebrow={platform.name} title={platform.tagline} />
            <p className="lead">{platform.summary}</p>
            <CheckList items={platform.features} />
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Good to know</h4>
              <ul className="mini-list">
                <li><BatteryCharging size={14} /> Hardware connections depend on the device and connection setup — scanners, printers and drawers connect where the setup supports them.</li>
                {platform.devices && (
                  <li><Monitor size={14} /> Typical devices: {platform.devices.join(" · ")}</li>
                )}
                <li><Globe size={14} /> onePOS is browser-based — the same account and data are available from any other device.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Benefits" title={`Why ${platform.name} works for a store`} />
          <div className="feature-grid feature-grid--3">
            {platform.benefits.map((b) => (
              <div className="feature-card feature-card--static" key={b.title}>
                <span className="icon-tile"><CheckListCheck /></span>
                <h3>{b.title}</h3>
                <p>{b.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="More platforms" title="OnePOS follows the device" />
          <div className="related-grid related-grid--3">
            {related.map((slug) => {
              const p = platformData[slug];
              const RIcon = DEVICE_ICON[slug] || Globe;
              return (
                <Link to={`/platform/${slug}`} className="related-card" key={slug}>
                  <span className="icon-tile icon-tile--sm">
                    {["windows", "android", "ios"].includes(slug) ? <BrandIcon name={slug} /> : <RIcon size={16} />}
                  </span>
                  <div>
                    <h4>{p.name}</h4>
                    <p>{p.tagline}</p>
                  </div>
                  <ArrowRight size={14} className="related-arrow" />
                </Link>
              );
            })}
            <Link to="/platforms" className="related-card">
              <span className="icon-tile icon-tile--sm"><Icon name="plug" size={16} /></span>
              <div>
                <h4>Offline & connectivity</h4>
                <p>How onePOS keeps the counter usable when the internet drops.</p>
              </div>
              <ArrowRight size={14} className="related-arrow" />
            </Link>
          </div>
        </div>
      </section>

      <CTASection
        title={`Put onePOS on your ${platform.name} device`}
        lead="Log in from the browser of your choice — the till, the stock and the reports are waiting."
      />
    </div>
  );
}

function CheckListCheck() {
  return (
    <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6.5 4.5 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}