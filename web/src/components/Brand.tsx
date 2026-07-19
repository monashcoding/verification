/** MAC brand mark — yellow disc with the stacked up/down chevron logo. */
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-logo" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 10.5 12 5l6 5.5M6 14l6 5.5 6-5.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="brand-name">MAC Verify</span>
    </div>
  );
}
