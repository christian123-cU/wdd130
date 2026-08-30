// ==========================================================================
// Soma Sasa mascots — inline SVG line-art, no external images/fonts.
// Each mascot is tied to a course via courses.json's "mascotId" field and
// used only in Young Learner mode.
// ==========================================================================

const MASCOTS = {
  nambari: {
    name: "Nambari",
    role: "Your Number Guide",
    accent: "#1D9E75",
    greeting: "Habari! Let's count together \u2014 I love numbers from the market!",
    retry: "Hakuna matata, let's try that sum again!",
    success: "Safi sana! You crunched those numbers like a pro!",
    // A friendly line-art elephant.
    svg: `
      <svg viewBox="0 0 100 100" role="img" aria-label="Nambari the elephant">
        <ellipse cx="50" cy="62" rx="30" ry="22" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2.5"/>
        <circle cx="34" cy="46" r="20" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2.5"/>
        <ellipse cx="20" cy="42" rx="10" ry="13" fill="#D8F0E5" stroke="#0D3B2E" stroke-width="2"/>
        <path d="M 30 58 Q 24 72 16 68 Q 22 66 22 58" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="30" cy="42" r="2.6" fill="#0D3B2E"/>
        <path d="M 40 40 Q 47 36 50 41" stroke="#0D3B2E" stroke-width="2" fill="none" stroke-linecap="round"/>
        <rect x="30" y="80" width="7" height="12" rx="3" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2"/>
        <rect x="63" y="80" width="7" height="12" rx="3" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2"/>
        <path d="M 44 30 Q 40 22 46 16" stroke="#0D3B2E" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>`,
  },
  herufi: {
    name: "Herufi",
    role: "Your Reading Guide",
    accent: "#0D3B2E",
    greeting: "Karibu! Let's sound out some words together.",
    retry: "Try again \u2014 sound it out nice and slow!",
    success: "Safi sana! Your reading is getting stronger every day!",
    // A friendly line-art parrot.
    svg: `
      <svg viewBox="0 0 100 100" role="img" aria-label="Herufi the parrot">
        <path d="M 50 90 Q 30 78 34 55 Q 36 32 55 22 Q 74 30 72 52 Q 70 78 50 90 Z" fill="#EAF6F0" stroke="#0D3B2E" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M 55 22 Q 52 12 62 8 Q 58 16 60 22 Z" fill="#1D9E75" stroke="#0D3B2E" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="47" cy="42" r="3" fill="#0D3B2E"/>
        <path d="M 40 46 Q 30 48 28 42 Q 34 40 40 42 Z" fill="#FFA726" stroke="#0D3B2E" stroke-width="2" stroke-linejoin="round"/>
        <path d="M 58 58 Q 74 60 78 72" stroke="#1D9E75" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M 40 70 Q 30 82 20 80" stroke="#FFA726" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M 46 74 Q 40 88 32 90" stroke="#1D9E75" stroke-width="3" fill="none" stroke-linecap="round"/>
      </svg>`,
  },
};

function getMascot(mascotId) {
  return MASCOTS[mascotId] || null;
}
