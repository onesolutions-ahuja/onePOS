import React from "react";
import { Link } from "react-router-dom";

/* Unknown marketing URLs render a real 404 instead of silently showing Home,
   so typos, removed pages and bad referrals are visible, not misleading. */
export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">404</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-3 text-slate-600">
        The page you asked for does not exist or was moved.
      </p>
      <div className="mt-8 flex items-center justify-center gap-4">
        <Link
          to="/"
          className="rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white hover:bg-teal-800"
        >
          Back to home
        </Link>
        <Link to="/help" className="font-semibold text-teal-700 hover:text-teal-800">
          Visit Help Centre
        </Link>
      </div>
    </main>
  );
}
