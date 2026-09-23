'use strict';

/* Product-level prompt contract. The local generator can use the same contract as
   an online model, while the builder remains the sole export authority. */
const PallettAIDesignDNA = (() => {
  const archetypes = {
    EDITORIAL_MAGAZINE: 'Sharp 0px buttons; paper-like surfaces; serif display type; asymmetrical columns; crisp 1px borders; deliberate print-inspired rhythm.',
    BENTO_GLASS: 'Pill-shaped 9999px buttons; multi-span bento cells; translucent glass surfaces with restrained backdrop blur; subtle radial glows.',
    BRUTALIST_KINETIC: 'Hard 4px offset shadows; 3px solid black strokes; hover translate shifts; marquee tickers; high-contrast grid patterns.',
    NEO_MINIMALIST: 'Compact monospaced pills; ultra-wide section padding; subtle SVG/noise texture overlays; left-aligned flows and quiet hierarchy.',
    ORGANIC_CLAY: 'Soft 16px corners; tactile inner shadows; warm pastel palette; floating elevated cards; generous, human spacing.',
    RETRO_CYBERPUNK: 'Outlined neon-glow buttons; dark surfaces; scanline pattern overlays; monospaced technical badges; luminous edge accents.'
  };
  const schema = {
    version: '1.0', type: 'pallettai.project', required: ['site', 'pages', 'design'],
    design: { archetype: 'string', tokens: { '--btn-radius': 'CSS length', '--btn-shadow': 'CSS shadow', '--btn-border': 'CSS border', '--bg-pattern': 'safe CSS background value' } },
    site: { name: 'string', tagline: 'string', facts: 'object', contact: 'object' },
    pages: [{ id: 'string', name: 'string', sections: [{ type: 'known section type', layout_variant: 'string', content: 'object' }] }]
  };
  const prompt = [
    'You are PallettAI Studio\'s design director. Create a genuinely distinctive site, not a recoloured template.',
    'First choose exactly one Visual Archetype from the allowed list. Do not blend archetypes unless the brief explicitly asks for a hybrid.',
    'Preserve every client fact exactly: names, prices, addresses, phones, URLs, opening hours and services are immutable.',
    'Vary page architecture, section order, type pairing, grid rhythm, hero composition, button geometry, surfaces, motion and background pattern. Avoid generic SaaS hero → three cards → testimonials repetition.',
    'Return ONLY valid JSON matching the project schema. No Markdown, comments, scripts, event handlers, remote code or untrusted HTML.',
    'Emit explicit design.tokens values for --btn-radius, --btn-shadow, --btn-border and --bg-pattern. Keep animation to transform/opacity and include reduced-motion intent.',
    'Use semantic page and section types supported by the compiler. Keep copy concise, specific to the brief, and accessible.'
  ].join('\n');
  return Object.freeze({ archetypes, schema, prompt, list: () => Object.keys(archetypes) });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PallettAIDesignDNA;
if (typeof window !== 'undefined') window.PallettAIDesignDNA = PallettAIDesignDNA;
