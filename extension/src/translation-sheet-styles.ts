export const translationSheetStyles = `
  :host {
    all: initial !important;
    display: block !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    color-scheme: dark !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    pointer-events: none;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.22);
    pointer-events: none;
  }

  .sheet {
    position: relative;
    display: flex;
    width: 100%;
    max-height: 52vh;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: 0;
    border-radius: 24px 24px 0 0;
    background: #1d1d1f;
    box-shadow: 0 -18px 48px rgba(0, 0, 0, 0.36);
    color: #f5f5f7;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
      sans-serif;
    font-size: 16px;
    line-height: 1.4;
    pointer-events: auto;
    transform: translateY(0);
    opacity: 1;
    transition:
      height 180ms ease,
      max-height 180ms ease,
      opacity 140ms ease,
      transform 180ms ease;
  }

  .sheet[data-expanded="true"] {
    height: calc(100vh - 16px - env(safe-area-inset-top));
    max-height: calc(100vh - 16px - env(safe-area-inset-top));
  }

  .topbar {
    position: relative;
    min-height: 46px;
    flex: none;
  }

  button {
    margin: 0;
    border: 0;
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }

  .handle {
    position: absolute;
    top: 0;
    left: 50%;
    width: 64px;
    height: 44px;
    padding: 0;
    background: transparent;
    cursor: pointer;
    transform: translateX(-50%);
  }

  .handle::before {
    position: absolute;
    top: 10px;
    left: 50%;
    width: 44px;
    height: 5px;
    border-radius: 999px;
    background: #66666b;
    content: "";
    transform: translateX(-50%);
  }

  .close {
    position: absolute;
    top: 1px;
    right: 8px;
    display: inline-flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #2d2d30;
    color: #d2d2d7;
    cursor: pointer;
    font-size: 23px;
    line-height: 1;
  }

  .handle:focus-visible,
  .close:focus-visible,
  .retry:focus-visible {
    outline: 3px solid #70a7ff;
    outline-offset: 2px;
  }

  .content {
    min-height: 0;
    padding: 0 24px calc(24px + env(safe-area-inset-bottom));
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .title {
    margin: 0;
    color: #f5f5f7;
    font-size: 23px;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  .part-of-speech {
    margin: 6px 0 0;
    color: #a1a1a6;
    font-size: 14px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .translation {
    margin: 28px 0 0;
    color: #f5f5f7;
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -0.008em;
    overflow-wrap: anywhere;
  }

  .explanation {
    margin: 6px 0 0;
    color: #b7b7bd;
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  .sentence-section {
    margin: 28px -24px 0;
    padding: 20px 24px 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .section-label {
    margin: 0 0 10px;
    color: #8e8e93;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .sentence {
    margin: 0;
    color: #d2d2d7;
    font-size: 17px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  mark {
    border-radius: 4px;
    background: rgba(112, 167, 255, 0.24);
    color: #ffffff;
    font-weight: 650;
    padding: 1px 2px;
  }

  .state-title {
    margin: 0;
    color: #f5f5f7;
    font-size: 20px;
    font-weight: 700;
  }

  .state-message {
    margin: 8px 0 0;
    color: #b7b7bd;
  }

  .retry {
    min-height: 44px;
    margin-top: 20px;
    padding: 10px 18px;
    border-radius: 12px;
    background: #f5f5f7;
    color: #1d1d1f;
    cursor: pointer;
    font-weight: 650;
  }

  .skeleton {
    display: grid;
    gap: 13px;
    padding: 2px 0 8px;
  }

  .skeleton-line {
    height: 16px;
    border-radius: 8px;
    background: linear-gradient(90deg, #2c2c2f 20%, #3a3a3e 50%, #2c2c2f 80%);
    background-size: 220% 100%;
    animation: taptranslate-shimmer 1.3s linear infinite;
  }

  .skeleton-line:first-child {
    width: 48%;
    height: 24px;
  }

  .skeleton-line:nth-child(2) {
    width: 72%;
  }

  .skeleton-line:last-child {
    width: 88%;
  }

  .visually-hidden {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0 0 0 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }

  @keyframes taptranslate-shimmer {
    from { background-position: 100% 0; }
    to { background-position: -100% 0; }
  }

  @media (min-width: 768px) {
    .sheet {
      max-width: 640px;
      margin-right: auto;
      margin-left: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet {
      transition-duration: 0.01ms;
    }

    .skeleton-line {
      animation-duration: 0.01ms;
      animation-iteration-count: 1;
    }
  }
`;
