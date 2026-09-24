import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navigation from "./components/Navigation";
import Footer from "./components/Footer";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

export default function MarketingSite() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="marketing-site">
      <ScrollToTop />
      <Navigation mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      <main className="marketing-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}