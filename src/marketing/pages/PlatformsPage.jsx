import React from "react";
import { Link } from "react-router-dom";
import {
  Globe,
  WifiOff,
  Wifi,
  RefreshCw,
  ArrowRight,
  BatteryCharging,
  Signal,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import platformData from "../data/platformData";

const DEVICES = [
  { slug: "web", icon: "web", title: "Web Browser", blurb: "Chrome, Edge, Firefox, Safari — the core onePOS experience, no install." },
  { slug: "windows", icon: "windows", title: "Microsoft Windows", blurb: "Desktop and touchscreen terminals running onePOS in the browser." },
  { slug: "android", icon: "android", title: "Android", blurb: "Android tablets with a touch-first till and portable checkout." },
  { slug: "ios", icon: "apple", title: "Apple iPad", blurb: "iPad in Safari — clean, touch-first POS on Apple hardware." },
];

const OFFLINE = [
  { icon: WifiOff, title: "Offline storage", blurb: "Essential context lives locally so the app stays usable without the internet." },
  { icon: RefreshCw, title: "Sync queue", blurb: "Activity waits in a queue and syncs when the connection returns." },
  { icon: Signal, title: "Connectivity status", blurb: "Network state is surfaced in the app, so the team knows where things stand." },
  { icon: Wifi, title: "Back online", blurb: "Queued work reconciles with the server once connectivity is back." },
];

export default function PlatformsPage() {
  usePageMeta({
    title: "onePOS | Platforms & offline — Windows, Android, iPad and the web",
    description:
      "onePOS is a hybrid retail platform: browser-based, it runs on Windows, Android tablets and iPad, with offline storage and a sync queue for when connectivity drops.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Platforms & Offline" }]}
        eyebrow="Hybrid platform"
        title="Choose the devices that suit your store — not the other way round"
        lead="onePOS runs in any modern browser, which means the same till, dashboard and reports work on Windows touch terminals, Android tablets and iPads. No business should be locked into one hardware vendor."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/hardware" variant="secondary">Hardware guide</Btn>
        </div>
      </PageHero>

      {/* Devices */}
      <section className="section section--flush">
        <div className="wrap">
          <div className="device-grid">
            {DEVICES.map((d) => (
              <Link to={`/platform/${d.slug}`} className="device-card" key={d.slug}>
                <span className="device-icon">
                  {d.icon === "web" ? <Globe size={26} /> : <BrandIcon name={d.icon} />}
                </span>
                <h3>{d.title}</h3>
                <p>{d.blurb}</p>
                <span className="feature-link">Platform page <ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
          <p className="channel-note">
            Microsoft, Android and Apple are trademarks of their respective owners. They appear here to
            identify device compatibility only.
          </p>
        </div>
      </section>

      {/* Hybrid section */}
      <section className="section">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="The hybrid idea" title="One product, every counter" />
            <p className="lead">
              onePOS is not a desktop program with a mobile afterthought, nor a phone app pretending to
              be a till. It is a modern web application — so the full experience follows the device, not
              the other way around.
            </p>
            <CheckList
              items={[
                "Same data and permissions on every screen",
                "Touch-first layout at the till",
                "Full keyboard and mouse support",
                "No per-device installs or version drift",
              ]}
            />
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Honest about hardware</h4>
              <p>
                Peripheral connectivity — scanners, printers, cash drawers — depends on the device and
                connection setup. Where a bridge or connector is needed, it lives in that setup layer,
                described in the hardware guide.
              </p>
              <Link to="/hardware" className="text-link">Read the hardware guide <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* Offline */}
      <section className="section section--dark">
        <div className="wrap">
          <SectionHead
            eyebrow="Offline & connectivity"
            title="The internet blinks. The till doesn't have to."
            lead="onePOS is designed to tolerate a flaky connection: key context stays local, activity queues, and reconciliation happens when connectivity returns."
            dark
          />
          <div className="feature-grid feature-grid--4 dark-cards">
            {OFFLINE.map((f) => {
              const Icon = f.icon;
              return (
                <div className="feature-card feature-card--dark" key={f.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.blurb}</p>
                </div>
              );
            })}
          </div>
          <div className="dark-note">
            <BatteryCharging size={16} />
            Offline behaviour is built to keep the counter usable during outages — precise offline scope
            is version- and configuration-dependent, so verify behaviour in your own setup.
          </div>
        </div>
      </section>

      <CTASection
        title="Run onePOS on the hardware you already own"
        lead="Log in to onePOS from any device and see the same store, the same stock and the same reports."
      />
    </div>
  );
}