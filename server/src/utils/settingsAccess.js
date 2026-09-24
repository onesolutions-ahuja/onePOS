/*
 * WHICH SETTINGS SECTIONS A CALLER MAY SEE — one pure function.
 *
 * The Settings surface renders its sections from this map AND gates each
 * section's content with it, so the two can never disagree. That drift was
 * real: the Platform content branch accepted `user.isPlatformDeveloper` while
 * the section list only accepted `isAdmin || isSuperadmin`, so a permitted
 * Platform Developer was allowed through the gate but could never select the
 * section — and `Message Templates` was listed for every user while its
 * content was admins-only, leaving a selectable but blank section.
 *
 * `undefined` means "not gated". These flags are DISCOVERABILITY ONLY: every
 * Settings endpoint keeps enforcing its own authorization, and the shell's
 * navigation entry for Settings grants nothing on its own.
 */
export function settingSectionAccess({
  isAdmin = false,
  isSuperadmin = false,
  isPlatformDeveloper = false,
  loyalty = false,
} = {}) {
  return {
    /* Enabled by the company's loyalty entitlement, not by a role. */
    "Customer Loyalty": loyalty === true,
    /* Host-level configuration. */
    "Server / API Configuration": isSuperadmin === true,
    /* Platform administration: company admins, platform superadmins, and the
       Platform Developer identity the Platform surface itself recognises. */
    Platform: isAdmin === true || isSuperadmin === true || isPlatformDeveloper === true,
    /* Message templates are company administration. */
    "Message Templates": isAdmin === true || isSuperadmin === true,
  };
}

/** True when a section may be listed/selected; ungated sections pass. */
export function sectionIsVisible(access, section) {
  return access?.[section] !== false;
}

export default { settingSectionAccess, sectionIsVisible };
