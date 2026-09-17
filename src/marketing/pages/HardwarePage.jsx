import React from "react";
import { Link } from "react-router-dom";
import {
  ScanLine,
  Printer,
  CircleDollarSign,
  Touchpad,
  CreditCard,
  Cable,
  ArrowRight,
  MousePointerClick,
  Wifi,
  Usb,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection } from "../components/Ui";
import { HardwareStrip } from "../components/AppMockups";

const CATEGORIES = [
  {
    icon: ScanLine,
    title: "Barcode scanners",
    blurb: "USB and Bluetooth scanners feed the till search as keyboard input — scan a code and the product lands in the basket.",
    note: "Connection depends on the device and its OS support for the scanner.",
  },
  {
    icon: Printer,
    title: "Receipt printers",
    blurb: "Receipts and invoice PDFs print through the device's printer setup — browser print flow where a local printer exists.",
    note: "Actual printing follows whatever printers your device/connection exposes.",
  },
  {
    icon: CircleDollarSign,
    title: "Cash drawers",
    blurb: "Drawer control works where the device connection exposes it — commonly driven through the printer/drawer bridge on supported setups.",
    note: "Not every tablet can pulse a drawer; the hardware guide explains which setups can.",
  },
  {
    icon: Touchpad,
    title: "Touchscreen displays",
    blurb: "The till is touch-first — big tiles, clear tap targets and a layout that works on touch terminals and tablets.",
    note: "Any touch display that runs a modern browser works.",
  },
  {
    icon: CreditCard,
    title: "Payment terminals",
    blurb: "Card payments are recorded at the sale; integrated terminal flows fit the device/connection setup.",
    note: "Terminal integration is part of the platform's payments direction — verify with your provider setup.",
  },
  {
    icon: Cable,
    title: "Bridge / connector layer",
    blurb: "Where hardware needs a bridge (scanner/drawer on a browser device), that connector lives in the setup layer rather than pretending the browser owns the port directly.",
    note: "The connector concept keeps claims honest: device-dependent by design.",
  },
];

export default function HardwarePage() {
  usePageMeta({
    title: "onePOS | Hardware — scanners, printers, drawers and touchscreens",
    description:
      "onePOS hardware compatibility: barcode scanners, receipt printers, cash drawers, touchscreen displays and payment terminals — device-dependent and explained honestly.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Hardware" }]}
        eyebrow="Hardware compatibility"
        title="The hardware your store already runs"
        lead="Scanners, receipt printers, cash drawers, touchscreens and payment terminals. onePOS connects to retail hardware where the device and connection setup supports it — explained honestly, not over-promised."
      >
        <div className="page-hero-actions">
          <Btn to="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/platforms" variant="secondary">Platforms & offline</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <div className="hw-visual">
            <HardwareStrip />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="What connects"
            title="Six pieces of kit, one honest guide"
            lead="Each category explains how it connects — and the note on each card says exactly what depends on the setup."
          />
          <div className="feature-grid feature-grid--3">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              return (
                <div className="feature-card feature-card--static" key={c.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{c.title}</h3>
                  <p>{c.blurb}</p>
                  <div className="hw-note"><Cable size={12} /> {c.note}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="How connectivity works" title="No pretend USB on a tablet" />
            <p className="lead">
              A browser can't silently own a USB port — so onePOS is honest about it. Device support
              depends on what the OS and connection expose, and where a bridge or connector is needed,
              it belongs to the setup layer.
            </p>
            <CheckList
              items={[
                "Scanners that behave like keyboards work everywhere",
                "Printer support follows the device's printer setup",
                "Drawers pulse through supported printer/drawer bridges",
                "Touchscreens: any modern browser on a touch display",
              ]}
            />
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Pair hardware with a platform</h4>
              <div className="mini-cards">
                <Link to="/platform/windows" className="mini-card mini-card--link">
                  <Wifi size={14} /> <span><b>Windows terminals</b> — full USB/Bluetooth flexibility</span>
                </Link>
                <Link to="/platform/android" className="mini-card mini-card--link">
                  <Usb size={14} /> <span><b>Android tablets</b> — Bluetooth/USB per device support</span>
                </Link>
                <Link to="/platform/ios" className="mini-card mini-card--link">
                  <MousePointerClick size={14} /> <span><b>iPad</b> — touch-first checkout, printer via setup</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap note-band">
          <span className="note-band-icon"><Cable size={20} /></span>
          <div>
            <h3>The right device for the right counter</h3>
            <p>
              A drinks counter with a scanner and a drawer may want a Windows all-in-one; a café taking
              orders tableside may want a tablet. onePOS runs on both — the hardware choice stays yours.
            </p>
          </div>
          <Btn to="/platforms" variant="secondary">See the platforms</Btn>
        </div>
      </section>

      <CTASection
        title="Pick your hardware, keep onePOS"
        lead="Log in from any device to see the same till — or read the platform pages to match hardware to your counters."
      />
    </div>
  );
}