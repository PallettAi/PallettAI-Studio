'use strict';

const ART_MOODS = {
  food: { lighting: 'warm directional light', framing: 'close details with one human moment', palette: 'natural textures and restrained colour', avoid: ['generic empty plates', 'logos', 'text overlays'] },
  beauty: { lighting: 'soft window light', framing: 'intimate portrait and material detail', palette: 'calm skin-safe neutrals', avoid: ['over-retouched skin', 'generic spa candles', 'text overlays'] },
  tech: { lighting: 'clean contrast with controlled glow', framing: 'human-scale workspace and product detail', palette: 'precise cool neutrals with one accent', avoid: ['empty laptop mockups', 'stock handshakes', 'text overlays'] },
  creative: { lighting: 'editorial natural light', framing: 'asymmetric subject-led compositions', palette: 'considered colour contrast', avoid: ['generic office teams', 'template screenshots', 'text overlays'] },
  home: { lighting: 'honest daylight', framing: 'before/after context and craft detail', palette: 'material-led, grounded neutrals', avoid: ['hard hats posing at camera', 'unoccupied rooms only', 'text overlays'] },
  generic: { lighting: 'natural, believable light', framing: 'one clear subject with lived-in context', palette: 'quietly brand-led colour', avoid: ['generic stock smiles', 'unrelated objects', 'text overlays'] }
};
function directionFor(typeId, look, seed) {
  const base = ART_MOODS[typeId] || ART_MOODS.generic;
  const variants = ['documentary', 'editorial', 'crafted', 'cinematic'];
  return {
    version: 1,
    mode: variants[Math.abs(Number(seed) || 0) % variants.length],
    mood: String(look || 'considered'),
    lighting: base.lighting,
    framing: base.framing,
    palette: base.palette,
    avoid: base.avoid.slice(),
    prompt: [base.lighting, base.framing, base.palette, 'no logos, no text overlays'].join('; ')
  };
}
const AiArtDirection = { directionFor, ART_MOODS };
if (typeof module !== 'undefined' && module.exports) module.exports = AiArtDirection;
