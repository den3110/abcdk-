/* eslint-disable react/prop-types */
import { A } from "../astryx/ui.jsx";

export default function SportBrand({ compact = false }) {
  return (
    <A
      href="/"
      aria-label="PickleTour"
      className="v3-brand"
      style={{ textDecoration: "none" }}
    >
      <img
        src="/pickletour-v3-logo.png"
        alt=""
        aria-hidden="true"
        className="v3-brand-mark"
      />
      <span className="v3-brand-monogram" aria-hidden="true">P</span>
      {!compact ? (
        <span className="v3-brand-copy">
          <span className="v3-brand-name">
            Pickle<span>Tour</span>
          </span>
          <span className="v3-brand-tagline">MORE THAN A GAME</span>
        </span>
      ) : null}
    </A>
  );
}
