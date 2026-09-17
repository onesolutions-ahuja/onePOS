import { useEffect } from "react";

const DEFAULT_DESCRIPTION =
  "onePOS — Complete retail management, POS and business platform. Connect your till, inventory, purchasing, customers and online channels in one platform.";

/**
 * Lightweight per-page SEO helper: sets document title and updates the
 * existing meta description / Open Graph / Twitter tags in index.html.
 */
export function usePageMeta({ title, description = DEFAULT_DESCRIPTION }) {
  useEffect(() => {
    document.title = title;

    const describe = document.head.querySelector('meta[name="description"]');
    if (describe) describe.setAttribute("content", description);

    const ogTitle = document.head.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);
    const ogDesc = document.head.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", description);

    const twTitle = document.head.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute("content", title);
    const twDesc = document.head.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute("content", description);
  }, [title, description]);
}