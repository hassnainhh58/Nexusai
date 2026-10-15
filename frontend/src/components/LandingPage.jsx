import { SignInButton, SignUpButton } from "@clerk/react";

import "./LandingPage.css";

const FEATURES = [
  {
    title: "Explore",
    description:
      "Ask anything and get thoughtful, well-reasoned answers in seconds.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M21 21l-4.35-4.35"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Research",
    description:
      "Pull live, current information from the web when the answer needs it.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3a9 9 0 100 18 9 9 0 000-18z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    title: "Calculate",
    description:
      "Work through math and logic problems with precise, step-by-step help.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect
          x="4"
          y="3"
          width="16"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M8 8h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Learn",
    description:
      "Break down technical concepts and new topics in plain, clear language.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4l9 4.5-9 4.5-9-4.5L12 4z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 10.75V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5.25"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const CURRENT_YEAR = new Date().getFullYear();

function LandingPage() {
  return (
    <div className="landing-page">
      <div className="landing-glow landing-glow-a" />
      <div className="landing-glow landing-glow-b" />

      <nav className="landing-nav">
        <div className="landing-brand">
          <div className="landing-brand-icon">N</div>
          <span>NexusAI</span>
        </div>

        <div className="landing-nav-actions">
          <SignInButton mode="modal">
            <button className="landing-nav-signin">Sign in</button>
          </SignInButton>

          <SignUpButton mode="modal">
            <button className="landing-nav-signup">Get started</button>
          </SignUpButton>
        </div>
      </nav>

      <main className="landing-hero">
        <div className="landing-badge">Powered by advanced AI</div>

        <h1 className="landing-headline">
          Your intelligent AI
          <br />
          assistant, ready when you are
        </h1>

        <p className="landing-subheadline">
          NexusAI helps you research, calculate, learn, and think through
          problems &mdash; all in one focused, professional workspace.
        </p>

        <div className="landing-cta-row">
          <SignUpButton mode="modal">
            <button className="landing-cta-primary">
              Create free account
            </button>
          </SignUpButton>

          <SignInButton mode="modal">
            <button className="landing-cta-secondary">
              I already have an account
            </button>
          </SignInButton>
        </div>

        <div className="landing-trust">
          No credit card required &middot; Secured by Clerk
        </div>
      </main>

      <section className="landing-features">
        {FEATURES.map((feature) => (
          <div className="landing-feature-card" key={feature.title}>
            <div className="landing-feature-icon">{feature.icon}</div>
            <div className="landing-feature-title">{feature.title}</div>
            <div className="landing-feature-description">
              {feature.description}
            </div>
          </div>
        ))}
      </section>

      <footer className="landing-footer">
        &copy; {CURRENT_YEAR} NexusAI. All rights reserved.
      </footer>
    </div>
  );
}

export default LandingPage;
