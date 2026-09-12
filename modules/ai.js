// ============================================================
// PallettAI Studio — AI Studio engine
// Generates complete, client-ready sites from a plain-English
// prompt. Fully offline-capable (local copy banks) with free
// online AI when available:
//   · Pollinations image API  -> AI hero / about / gallery images
//   · Pollinations text API   -> AI copy enhancement
// Both degrade gracefully to local generators + Picsum.
// ============================================================

const AI = (() => {
  const STOP = new Set(['in', 'the', 'for', 'and', 'with', 'of', 'a', 'an', 'to', 'at', 'by', 'my', 'our', 'we', 'i', 'want', 'need', 'make', 'build', 'create', 'design', 'site', 'website', 'web', 'page', 'for']);

  const hash = (s) => {
    let h = 7;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
  const uid = () => 'ai_' + Math.random().toString(36).slice(2, 10);

  // ============================================================
  // AI Studio 2.0 — subject + taste intelligence, design DNA
  // ============================================================

  // descriptive words we never want in the “focus” phrase or image search
  const ADJS = new Set(['modern', 'contemporary', 'cozy', 'warm', 'rustic', 'artisanal', 'artisan', 'handmade', 'organic', 'natural', 'fresh', 'bold', 'playful', 'elegant', 'luxurious', 'premium', 'luxury', 'high-end', 'upscale', 'exclusive', 'sleek', 'minimal', 'clean', 'stylish', 'chic', 'trendy', 'urban', 'gritty', 'raw', 'vintage', 'retro', 'family', 'local', 'independent', 'small', 'boutique', 'holistic', 'authentic', 'honest', 'friendly', 'creative', 'colourful', 'colorful', 'bright', 'soft', 'subtle', 'editorial', 'refined', 'classic', 'timeless', 'custom', 'bespoke', 'sustainable', 'eco', 'quirky', 'eclectic', 'vibrant', 'energetic', 'calming', 'tranquil', 'serene', 'world-class', 'award-winning', 'experienced', 'trusted', 'reliable', 'professional', 'innovative', 'futuristic', 'cutting-edge', 'digital', 'intuitive', 'seamless', 'effortless', 'delicious', 'tasty', 'gourmet', 'seasonal', 'plant-based', 'vegan', 'healthy', 'great', 'best', 'amazing', 'nice', 'beautiful', 'lovely', 'popular', 'busy', 'successful']);

  // concrete “what do they actually sell/do” knowledge — powers copy focus,
  // scene-appropriate real photos and better type detection.
  const SUBJECTS = [
    { type: 'food', k: ['wood-fired', 'pizzeria', 'pizza'], focus: 'wood-fired pizza', scenes: { hero: 'pizza', about: 'pizzeria restaurant interior', gallery: 'pizza' } },
    { type: 'food', k: ['coffee roaster', 'roastery', 'coffee shop', 'espresso', 'specialty coffee', 'coffee'], focus: 'specialty coffee', scenes: { hero: 'barista pouring coffee', about: 'coffee shop interior', gallery: 'specialty coffee' } },
    { type: 'food', k: ['patisserie', 'croissant', 'bakery', 'bread', 'baked goods'], focus: 'fresh baked goods', scenes: { hero: 'fresh bread and pastries', about: 'bakery counter display', gallery: 'bread and pastries' } },
    { type: 'food', k: ['brunch', 'breakfast'], focus: 'breakfast and brunch', scenes: { hero: 'brunch table spread', about: 'breakfast cafe interior', gallery: 'brunch food' } },
    { type: 'food', k: ['burger', 'burgers', 'smash burger'], focus: 'gourmet burgers', scenes: { hero: 'gourmet burger', about: 'burger restaurant interior', gallery: 'burgers and fries' } },
    { type: 'food', k: ['sushi', 'japanese', 'ramen', 'noodles', 'asian'], focus: 'Japanese food', scenes: { hero: 'sushi platter', about: 'japanese restaurant interior', gallery: 'sushi and ramen' } },
    { type: 'food', k: ['indian', 'curry', 'tandoori'], focus: 'Indian food', scenes: { hero: 'indian curry dishes', about: 'indian restaurant interior', gallery: 'indian food' } },
    { type: 'food', k: ['thai', 'vietnamese', 'pho'], focus: 'Southeast Asian food', scenes: { hero: 'thai food', about: 'asian restaurant interior', gallery: 'asian street food' } },
    { type: 'food', k: ['taco', 'tacos', 'mexican'], focus: 'Mexican food', scenes: { hero: 'tacos', about: 'mexican restaurant interior', gallery: 'mexican food' } },
    { type: 'food', k: ['seafood', 'fish', 'oyster', 'lobster'], focus: 'fresh seafood', scenes: { hero: 'grilled seafood platter', about: 'seafood restaurant interior', gallery: 'seafood dishes' } },
    { type: 'food', k: ['steakhouse', 'steak', 'grill', 'bbq', 'barbecue'], focus: 'grilled meats', scenes: { hero: 'grilled steak', about: 'steakhouse interior', gallery: 'grill and barbecue' } },
    { type: 'food', k: ['ice cream', 'dessert', 'cake', 'chocolate'], focus: 'handmade desserts', scenes: { hero: 'dessert plated beautifully', about: 'patisserie dessert display', gallery: 'desserts and cakes' } },
    { type: 'food', k: ['wine bar', 'wine', 'vineyard'], focus: 'fine wine', scenes: { hero: 'wine glasses pouring', about: 'wine bar interior', gallery: 'wine cellar' } },
    { type: 'food', k: ['cocktail', 'craft beer', 'pub', 'brewery', 'bar'], focus: 'craft drinks', scenes: { hero: 'craft cocktail', about: 'bar interior moody', gallery: 'cocktails and drinks' } },
    { type: 'retail', k: ['florist', 'flower shop', 'flowers'], focus: 'fresh flowers', scenes: { hero: 'colorful flower bouquet', about: 'flower shop interior', gallery: 'flower arrangements' } },
    { type: 'retail', k: ['jewelry', 'jewellery', 'watches'], focus: 'handcrafted jewelry', scenes: { hero: 'gold jewelry close up', about: 'jewelry boutique interior', gallery: 'jewelry design' } },
    { type: 'retail', k: ['clothing', 'fashion', 'boutique'], focus: 'curated fashion', scenes: { hero: 'fashion boutique clothing rack', about: 'clothing boutique interior', gallery: 'fashion apparel' } },
    { type: 'beauty', k: ['hair salon', 'hairdresser', 'barber shop', 'barber'], focus: 'hair care', scenes: { hero: 'hairstylist cutting hair in salon', about: 'hair salon interior', gallery: 'hair styling' } },
    { type: 'beauty', k: ['nail salon', 'nails', 'manicure'], focus: 'nail art', scenes: { hero: 'nail art manicure', about: 'nail salon interior', gallery: 'nail design' } },
    { type: 'beauty', k: ['day spa', 'spa', 'massage', 'wellness', 'skincare', 'facials'], focus: 'wellness treatments', scenes: { hero: 'spa towels and candles', about: 'spa treatment room', gallery: 'spa and wellness' } },
    { type: 'beauty', k: ['makeup', 'cosmetics', 'lash'], focus: 'beauty treatments', scenes: { hero: 'makeup brushes and cosmetics', about: 'beauty salon interior', gallery: 'makeup artistry' } },
    { type: 'fitness', k: ['personal trainer', 'crossfit', 'workout', 'gym'], focus: 'training', scenes: { hero: 'athlete training in gym', about: 'modern gym interior', gallery: 'fitness training' } },
    { type: 'fitness', k: ['yoga', 'pilates', 'meditation'], focus: 'mindful movement', scenes: { hero: 'yoga class studio', about: 'yoga studio interior', gallery: 'yoga poses' } },
    { type: 'fitness', k: ['boxing', 'mma', 'martial arts'], focus: 'fight training', scenes: { hero: 'boxing training', about: 'boxing gym interior', gallery: 'boxing gym' } },
    { type: 'generic', k: ['dog grooming', 'pet grooming', 'dog groomer', 'pets'], focus: 'pet care', scenes: { hero: 'dog grooming', about: 'dog groomer at work', gallery: 'happy dogs' } },
    { type: 'home', k: ['interior design', 'interior', 'home renovation', 'renovation'], focus: 'home transformation', scenes: { hero: 'bright renovated living room', about: 'interior designer at work', gallery: 'home interiors' } },
    { type: 'home', k: ['landscaping', 'landscape design', 'garden'], focus: 'outdoor spaces', scenes: { hero: 'beautiful landscaped garden', about: 'gardener landscaping', gallery: 'gardens and plants' } },
    { type: 'auto', k: ['car wash', 'detailing'], focus: 'car detailing', scenes: { hero: 'car being detailed', about: 'car wash bay', gallery: 'clean cars' } },
    { type: 'events', k: ['wedding', 'weddings'], focus: 'weddings', scenes: { hero: 'wedding couple ceremony', about: 'wedding venue decoration', gallery: 'wedding details' } },
    { type: 'music', k: ['recording studio', 'music production', 'producer'], focus: 'music production', scenes: { hero: 'recording studio microphone', about: 'music producer at console', gallery: 'studio sessions' } },
    { type: 'nonprofit', k: ['animal rescue', 'dog rescue', 'cat rescue'], focus: 'animal welfare', scenes: { hero: 'rescue dog being cared for', about: 'animal shelter volunteers', gallery: 'rescued animals' } }
  ];

  // per-industry photographic scene (used when no specific subject matches)
  const TYPE_SCENES = {
    tech:     { hero: 'modern technology office',      about: 'software team working in a modern office', gallery: 'technology and teamwork' },
    creative: { hero: 'creative studio with moodboards', about: 'designers collaborating in a studio', gallery: 'design studio craft' },
    food:     { hero: 'restaurant table with food',     about: 'restaurant interior', gallery: 'food and dining' },
    retail:   { hero: 'curated retail storefront',      about: 'shop interior with products', gallery: 'retail products' },
    travel:   { hero: 'beautiful mountain landscape',   about: 'traveller with backpack', gallery: 'travel destinations' },
    fitness:  { hero: 'people training in a gym',       about: 'modern gym interior', gallery: 'fitness training' },
    beauty:   { hero: 'salon styling session',          about: 'beauty salon interior', gallery: 'beauty treatments' },
    edu:      { hero: 'bright modern classroom',        about: 'teacher helping students', gallery: 'students learning' },
    home:     { hero: 'renovated bright home interior', about: 'renovation work', gallery: 'home improvement' },
    events:   { hero: 'elegant event venue',            about: 'event decoration details', gallery: 'events and celebrations' },
    auto:     { hero: 'classic car in a workshop',      about: 'mechanic working on a car', gallery: 'cars and workshop' },
    music:    { hero: 'live music stage lights',        about: 'musician performing', gallery: 'live music' },
    nonprofit:{ hero: 'volunteers working together',    about: 'community volunteers', gallery: 'community support' },
    generic:  { hero: 'warm inviting modern space',     about: 'people working happily together', gallery: 'craft and details' }
  };

  // A short, natural noun phrase that slots into the copy banks' {focus}
  // when the prompt doesn't name a concrete product or service.
  const TYPE_FOCUS = {
    tech: 'software', creative: 'brands and campaigns', food: 'seasonal dishes',
    retail: 'curated goods', travel: 'trips', fitness: 'training',
    beauty: 'beauty treatments', edu: 'learning', home: 'spaces',
    events: 'celebrations', auto: 'cars', music: 'music',
    nonprofit: 'change', generic: 'our work'
  };

  // ============================================================
  // Deep content packs — sub-niche knowledge so a site reads like
  // an expert in that trade wrote it, not a template. When the
  // prompt (or a studied website) names one of these, its content
  // overrides the industry copy bank and adds niche sections
  // (e.g. a real menu table for a pizzeria).
  // ============================================================
  // Field keys keep the table compact: t=taglines, feat=features,
  // stats, faqs, testis, price=pricing, cta, gal=gallery captions,
  // menu=extra price/menu table section.
  const NICHES = [
    {
      id: 'pizzeria', name: 'Wood-Fired Pizzeria', type: 'food',
      k: ['wood fired pizza', 'wood-fired pizza', 'neapolitan pizza', 'pizzeria', 'pizza restaurant', 'pizza place', 'pizza shop', 'pizza', 'dough'],
      focus: 'wood-fired pizza',
      scenes: { hero: 'wood fired pizza oven flame', about: 'pizzeria interior wood fired oven', gallery: 'neapolitan pizza' },
      t: [
        "{brand} — blistered crusts, honest toppings, fired at 450°C the way Naples intended.",
        "Real pizza needs a real oven. At {brand}, every pie is wood-fired to order — 90 seconds, zero shortcuts.",
        "Dough proved for 48 hours, tomatoes from volcanic soil, mozzarella pulled that morning. Welcome to {brand}."
      ],
      about: "{brand} started with a brick oven we built by hand and a stubborn belief: great pizza is a craft, not a recipe. Our dough ferments for 48 hours, our tomato passata comes from a single farm on Vesuvius, and every pie spends 90 seconds in a 450°C wood-fired oven until the crust blisters and the centre stays soft. Come for the margherita, stay for the cannoli.",
      aboutTitle: 'Our oven & our story',
      feat: [
        { icon: '🔥', title: 'Wood-Fired, Always', text: 'A 450°C stone oven fired with real beechwood — never gas, never frozen bases.' },
        { icon: '🌾', title: '48-Hour Dough', text: 'Slow-fermented for flavour and digestibility. Naturally leavened, never rushed.' },
        { icon: '🍅', title: 'Single-Farm Tomatoes', text: 'San Marzano grown on volcanic soil, hand-crushed and untouched by additives.' },
        { icon: '🛵', title: 'Pizza That Travels', text: 'Boxed hot-side-down in vented boxes so your pie arrives blistered, not soggy.' }
      ],
      stats: [
        { title: 'Oven temperature', text: '450°C' }, { title: 'Dough ferment', text: '48h' },
        { title: 'Guest rating', text: '4.9★' }, { title: 'Pies served / week', text: '2,100' }
      ],
      faqs: [
        { title: 'Do you take bookings?', text: 'Yes — tables for dinner and the full pizzeria experience. Walk-ins are welcome at the counter and bar.' },
        { title: 'Is there a gluten-free option?', text: 'We make a 48-hour gluten-free base in-house most days. Call ahead and we will hold one for you.' },
        { title: 'Do you deliver hot?', text: 'Our delivery boxes keep the base crisp and the toppings hot. We deliver within 45 minutes of the oven.' },
        { title: 'Can we book the whole place?', text: 'Yes — private hires and pizza-making parties are our favourite kind of chaos. Ask about the dough workshop.' }
      ],
      testis: [
        { title: 'Marco Rossi', text: 'The closest thing to Naples I have found outside Naples. That crust. That leopard-spotting.', extra: 'Regular since 2021' },
        { title: 'Hannah Cole', text: 'We ordered for a party of ten and every single box arrived blistered and perfect.', extra: 'Delivery customer' },
        { title: 'Diego Fontana', text: 'Booked the dough workshop for our team. Messy, brilliant, unforgettable.', extra: 'Private hire' }
      ],
      price: [
        { icon: '🍕', title: 'Classica', text: '£9–14', extra: 'Margherita, marinara, diavola & friends', tag: '' },
        { icon: '👑', title: 'Signature', text: '£14–19', extra: 'Truffle, nduja, burrata — our specials', tag: 'Popular' },
        { icon: '🎉', title: 'Pizza Party', text: '£26 pp', extra: 'Dough workshop + tasting flight', tag: '' }
      ],
      cta: { title: 'Your table by the oven is ready', text: 'Book tonight — the dough waits for no one.' },
      gal: ['Margherita out of the oven', 'Burrata & prosciutto pie', 'The dough room at dawn', 'Diavola with nduja', 'Oven fire at service', 'Tiramisu to finish'],
      menu: {
        title: 'The menu', subtitle: 'Fired to order in 90 seconds — every pie, every day.',
        cols: ['Pizza', 'What is on it', 'Price'],
        rows: [
          ['Margherita', 'San Marzano, fior di latte, basil, olive oil', '£9'],
          ['Marinara', 'Tomato, garlic, oregano, extra-virgin olive oil', '£8'],
          ['Diavola', 'Spicy salami, chilli honey, fior di latte', '£13'],
          ['Nduja & Burrata', 'Creamy nduja, burrata, rocket, lemon zest', '£15'],
          ['Tartufo', 'Porcini cream, mozzarella, black truffle, parmesan', '£17'],
          ['Contadina', 'Roast squash, smoked scamorza, walnuts, sage butter', '£14'],
          ['Tiramisu', 'Our grandmother recipe, made that morning', '£6'],
          ['Cannoli', 'Sicilian shells, sweet ricotta, pistachio', '£5']
        ]
      }
    },
    {
      id: 'coffee', name: 'Specialty Coffee Roastery', type: 'food',
      k: ['specialty coffee', 'coffee roaster', 'coffee roasters', 'roastery', 'coffee shop', 'espresso bar', 'coffee bar', 'cafe', 'café', 'coffee'],
      focus: 'specialty coffee',
      scenes: { hero: 'barista pouring latte art', about: 'specialty coffee shop interior', gallery: 'specialty coffee brewing' },
      t: [
        "{brand} — single-origin beans, roasted here weekly, pulled with intent.",
        "The best cup in the city is the one that is brewed properly. At {brand} we obsess over both.",
        "Traceable beans, transparent pricing, and milk texturing you can set a watch by — {brand}."
      ],
      about: "{brand} began as a sack of green beans and a roaster we could barely lift. Today we roast single origins in small weekly batches, cup everything we buy, and pay farmers directly through long-term partnerships. Our baristas train for months before they touch the machine — because a £30 bean deserves a perfect extraction, every single time.",
      aboutTitle: 'Roasted on site',
      feat: [
        { icon: '🫘', title: 'Small-Batch Roasting', text: 'Every origin roasted fresh in-house every week — never warehouse stock.' },
        { icon: '🤝', title: 'Direct Trade', text: 'We buy from the same farms every season and pay above fair-trade minimums.' },
        { icon: '🥛', title: 'Textured Milk, Always', text: 'Silky microfoam, precise temperature — the difference you can taste.' },
        { icon: '☕', title: 'Brew Bar & Retail', text: 'Take the same beans home — ground to your brewer, dated and sealed.' }
      ],
      stats: [
        { title: 'Origins on the bar', text: '8' }, { title: 'Roasted weekly', text: '120kg' },
        { title: 'Farm partners', text: '14' }, { title: 'Coffee rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'Do you sell beans to take home?', text: 'Yes — every origin we brew is on the shelf, roasted within the last seven days and dated.' },
        { title: 'Can you recommend a brew method?', text: 'Tell us how you like your coffee and we will match a bean, roast and recipe to your brewer.' },
        { title: 'Is there seating to work from?', text: 'Plenty — tables with power, fast Wi-Fi, and a refill policy we are proud of.' },
        { title: 'Do you offer wholesale?', text: 'We supply cafés, restaurants and offices across the region. Ask at the counter for a wholesale sheet.' }
      ],
      testis: [
        { title: 'Alice Tan', text: 'The flat white here ruined every other coffee shop for me. I am not even mad.', extra: 'Daily regular' },
        { title: 'Rob Whitfield', text: 'Their wholesale beans doubled our dessert sales. Customers ask what we serve.', extra: 'Café owner' },
        { title: 'Maya Osei', text: 'Took the cupping class — now I can actually taste what they mean by “stone fruit”.', extra: 'Home brewer' }
      ],
      price: [
        { icon: '☕', title: 'Espresso', text: '£2.80', extra: 'Single origin, switched weekly', tag: '' },
        { icon: '🥛', title: 'Flat White', text: '£3.80', extra: 'Double shot, velvet microfoam', tag: 'Popular' },
        { icon: '🫘', title: '250g Bag', text: '£11', extra: 'Roasted within the last 7 days', tag: '' }
      ],
      cta: { title: 'Your best cup of the week is waiting', text: 'Come taste this week’s single origin — first 30 cups on the pour-over bar daily.' },
      gal: ['Pour-over at the brew bar', 'Fresh roast out of the drum', 'Latte art in motion', 'The cupping table', 'Single origins on the shelf', 'Cold brew tap'],
      menu: {
        title: 'The menu', subtitle: 'Espresso classics, batch brew and kitchen favourites — all day.',
        cols: ['Drink', 'Notes', 'Price'],
        rows: [
          ['Espresso', 'Current single origin, switched weekly', '£2.80'],
          ['Flat White', 'Double shot, velvet-textured milk', '£3.80'],
          ['Cortado', 'Equal parts espresso and steamed milk', '£3.40'],
          ['Batch Brew', 'Filter coffee, brewed fresh every hour', '£3.20'],
          ['Mocha', 'Dark chocolate, espresso, steamed milk', '£4.20'],
          ['Chai Latte', 'House spice blend, oat or dairy', '£4.00'],
          ['Sourdough Toast', 'Whipped ricotta, honey and sea salt', '£6.50'],
          ['Almond Croissant', 'Baked in-house each morning', '£4.20']
        ]
      }
    },
    {
      id: 'bakery', name: 'Artisan Bakery & Patisserie', type: 'food',
      k: ['bakery', 'patisserie', 'boulangerie', 'croissant', 'sourdough', 'bread', 'pastry', 'baked goods', 'cake shop', 'baker'],
      focus: 'fresh-baked bread & pastries',
      scenes: { hero: 'fresh sourdough bread loaves', about: 'bakery display counter pastries', gallery: 'artisan bread and pastries' },
      t: [
        "{brand} — baked at 4am, gone by noon. Real bread, real butter, real early starts.",
        "Flour, water, salt and time. {brand} adds nothing you cannot spell.",
        "The smell that pulls you in off the street — that is {brand} baking."
      ],
      about: "{brand} bakes the old way: a sourdough starter we have fed since day one, stone-milled local flour, French butter, and ovens that start before the streetlights go off. We make small batches through the day so everything you buy was baked within hours — and we throw nothing away. The bakery bin at the door is free for anyone who needs it.",
      aboutTitle: 'Baked from scratch, daily',
      feat: [
        { icon: '🌾', title: 'Stone-Milled Flour', text: 'Local grain, milled fresh — bread with actual flavour in the crumb.' },
        { icon: '⏰', title: 'Baked All Day', text: 'Small batches every few hours, so nothing sits past its best.' },
        { icon: '🧈', title: 'French Butter', text: 'Real AOC butter in every croissant — nothing else tastes like this.' },
        { icon: '♻️', title: 'Zero Waste', text: 'Day-old loaves become croutons, breadcrumbs and our famous bread pudding.' }
      ],
      stats: [
        { title: 'Loaves / day', text: '400' }, { title: 'Sourdough starter age', text: '11y' },
        { title: 'Flour origin', text: '100% local' }, { title: 'Bakery rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'When do things sell out?', text: 'The first croissant batch lands at 7am — by 10am the popular ones are gone. Loaves run all day.' },
        { title: 'Do you make gluten-free bread?', text: 'Yes — a seeded gluten-free loaf baked fresh on Wednesdays and Saturdays.' },
        { title: 'Can I order a celebration cake?', text: 'Absolutely. Give us 48 hours notice and tell us your flavour, size and date.' },
        { title: 'Do you deliver?', text: 'Local delivery every morning before 9am for orders placed the night before.' }
      ],
      testis: [
        { title: 'Priya Nair', text: 'Their sourdough ruined supermarket bread for my whole family. Worth every penny.', extra: 'Saturday regular' },
        { title: 'James Hartley', text: 'Ordered the tres leches cake for my mum’s 70th. She cried. Success.', extra: 'Celebration cake' },
        { title: 'Sofia Greco', text: 'The almond croissant should be illegal. I have said this to the staff many times.', extra: 'Daily customer' }
      ],
      price: [
        { icon: '🥖', title: 'Sourdough Loaf', text: '£4.80', extra: 'Stone-milled, 24-hour ferment', tag: '' },
        { icon: '🥐', title: 'Croissant', text: '£3.20', extra: 'French butter, baked all day', tag: 'Popular' },
        { icon: '🎂', title: 'Celebration Cake', text: 'from £38', extra: '48h notice, your flavours', tag: '' }
      ],
      cta: { title: 'Baked this morning, gone by noon', text: 'Set an alarm — or pre-order and skip the queue.' },
      gal: ['Sourdough scoring', 'Croissants at 7am', 'The starter being fed', 'Pistachio danish', 'Bread pudding, day two', 'Cake counter'],
      menu: {
        title: 'Today at the counter', subtitle: 'Baked in batches through the day — what you see is what was made this morning.',
        cols: ['Bake', 'What it is', 'Price'],
        rows: [
          ['White Sourdough', '24-hour ferment, crisp crust, open crumb', '£4.80'],
          ['Seeded Rye', 'Three seeds, dark and dense', '£5.20'],
          ['Butter Croissant', 'AOC butter, laminated by hand', '£3.20'],
          ['Pain au Chocolat', 'Dark 70% batons inside flaky layers', '£3.60'],
          ['Almond Croissant', 'Twice-baked with frangipane', '£4.20'],
          ['Cardamom Bun', 'Swedish recipe, pearl sugar', '£3.90'],
          ['Sourdough Pizza Slice', 'Margherita or nduja, lunchtime only', '£5.50'],
          ['Bread Pudding', 'Made from yesterday’s loaves — never waste', '£3.50']
        ]
      }
    },
    {
      id: 'burger', name: 'Gourmet Burger Joint', type: 'food',
      k: ['burger', 'burgers', 'smash burger', 'smash burgers', 'double smash', 'burger bar', 'burger joint'],
      focus: 'smash burgers',
      scenes: { hero: 'smash burger with melted cheese', about: 'burger restaurant counter', gallery: 'burgers and fries' },
      t: [
        "{brand} — hand-smashed, griddle-crisped, and gone before you finish your fries.",
        "Two patties, one thin crust of flavour. {brand} does smash burgers the right way.",
        "The burgers are small-batch beef, the buns are potato rolls, and the queues are worth it — {brand}."
      ],
      about: "{brand} exists because a burger should be an event, not a default. We smash fresh never-frozen beef onto a hot griddle for that thin, lacy, caramelised crust, blanket it in American cheese, and stack it on a toasted potato roll we bake ourselves. The fries are double-cooked in beef tallow. The shakes are proper ice cream. Come hungry, leave sticky.",
      aboutTitle: 'The smash method',
      feat: [
        { icon: '🥩', title: 'Never-Frozen Beef', text: 'Fresh 100% chuck ground daily, smashed to order on the griddle.' },
        { icon: '🍞', title: 'House Potato Buns', text: 'Baked in-house — soft enough to squish, sturdy enough to hold.' },
        { icon: '🧀', title: 'Real Cheese, Real Toppings', text: 'American, cheddar or blue — plus pickles we ferment ourselves.' },
        { icon: '🍟', title: 'Beef-Tallow Fries', text: 'Double-cooked for the shatter-crisp outside and fluffy middle.' }
      ],
      stats: [
        { title: 'Burgers / weekend', text: '900+' }, { title: 'Beef source', text: 'Local farm' },
        { title: 'Guest rating', text: '4.8★' }, { title: 'Secret sauce batches', text: 'Weekly' }
      ],
      faqs: [
        { title: 'Can you do gluten-free?', text: 'Yes — lettuce wrap or a house gluten-free bun. Fries are GF, the onion rings are not.' },
        { title: 'Is the beef really fresh?', text: 'Ground every morning from whole chuck. Nothing in this kitchen has ever been frozen.' },
        { title: 'Do you take bookings?', text: 'Walk-ins always; groups of 6+ can book the long table. We do not take single-party reservations under 6.' },
        { title: 'Is there a veggie option?', text: 'The mushroom smash — a portobello cap, smashed and griddled the same way — is a staff favourite.' }
      ],
      testis: [
        { title: 'Leo Martins', text: 'The smash crust on that burger is a religious experience. Fries too.', extra: 'Borough regular' },
        { title: 'Cara Doyle', text: 'Took the office here on a Tuesday. Nobody has stopped talking about it since.', extra: 'Group booking' },
        { title: 'Ben Okafor', text: 'Mushroom smash converted my vegetarian mate. Say no more.', extra: 'Verified review' }
      ],
      price: [
        { icon: '🍔', title: 'Classic Smash', text: '£9.50', extra: 'Double smash, cheese, house sauce', tag: '' },
        { icon: '🔥', title: 'The Inferno', text: '£12', extra: 'Nduja, jalapeños, hot honey', tag: 'Popular' },
        { icon: '🍟', title: 'Smash + Fries', text: '£13.50', extra: 'Any burger, tallow fries, dip', tag: '' }
      ],
      cta: { title: 'Come get messy', text: 'The griddle is hot from noon — walk in, order up, napkins provided.' },
      gal: ['The double smash stack', 'Fresh off the griddle', 'Tallow fries moment', 'Secret sauce application', 'Mushroom smash', 'Milkshake hour'],
      menu: {
        title: 'The menu', subtitle: 'Smashed to order on a flat-top — everything arrives with house pickles.',
        cols: ['Burger', 'What is on it', 'Price'],
        rows: [
          ['Classic Smash', 'Double beef, American cheese, sauce, pickles', '£9.50'],
          ['Bacon Double', 'Double smash, smoked bacon, cheddar, bourbon glaze', '£11.50'],
          ['The Inferno', 'Nduja, jalapeños, hot honey, blue cheese', '£12.00'],
          ['Mushroom Smash', 'Smashed portobello, gruyère, truffle mayo', '£10.50'],
          ['Crispy Chicken', 'Buttermilk fried thigh, slaw, honey mustard', '£10.00'],
          ['Tallow Fries', 'Double-cooked, sea salt', '£4.00'],
          ['Onion Rings', 'Beer-battered, ranch dip', '£4.50'],
          ['Vanilla Shake', 'Real ice cream, whipped cream', '£5.00']
        ]
      }
    },
    {
      id: 'japanese', name: 'Japanese Kitchen', type: 'food',
      k: ['sushi', 'sushi bar', 'sushi restaurant', 'ramen', 'ramen bar', 'japanese restaurant', 'izakaya', 'japanese food', 'teppanyaki'],
      focus: 'Japanese food',
      scenes: { hero: 'sushi platter chef', about: 'japanese restaurant interior', gallery: 'sushi and ramen dishes' },
      t: [
        "{brand} — rice seasoned the old way, fish cut to order, broth simmered for 18 hours.",
        "From the sushi counter to the ramen bar, {brand} treats Japanese food with the respect it deserves.",
        "Sharp knives, patient broths, precise rice. {brand} is Japanese cooking done properly."
      ],
      about: "{brand} is a two-room house: a six-seat sushi counter where our itamae cuts fish to order over seasoned rice, and a steamy ramen bar serving tonkotsu broth that simmers for 18 hours before service. We fly in fish three times a week, make our own noodles, and never compromise on the rice — because Japanese food is 80% fundamentals and 20% theatre.",
      aboutTitle: 'Counter & ramen bar',
      feat: [
        { icon: '🐟', title: 'Flown-In Fish, Daily', text: 'Three deliveries a week from Toyosu — nothing sits beyond its prime.' },
        { icon: '🍜', title: '18-Hour Broth', text: 'Tonkotsu simmered overnight, then finished with tare we age for months.' },
        { icon: '🍚', title: 'Proper Sushi Rice', text: 'Seasoned with akazu vinegar, held at body temperature — the detail that matters.' },
        { icon: '🔪', title: 'Knife Skills, On Show', text: 'Watch your nigiri cut and pressed at the counter, then eat it within seconds.' }
      ],
      stats: [
        { title: 'Broth simmer', text: '18h' }, { title: 'Fish deliveries / week', text: '3' },
        { title: 'Counter seats', text: '6' }, { title: 'Guest rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'Do I need to book the sushi counter?', text: 'Yes — six seats, two sittings. Book at least a week ahead for weekends. The ramen bar is walk-in.' },
        { title: 'Is there an omakase option?', text: 'The chef’s omakase is a set menu of the day’s best fish — around 12 pieces plus a hand roll.' },
        { title: 'Do you have vegetarian options?', text: 'The ramen bar has a miso mushroom bowl, and the counter offers vegetable nigiri and inari by request.' },
        { title: 'Can you handle allergies?', text: 'Tell us when you book. We keep a separate board, knife and station for any allergy.' }
      ],
      testis: [
        { title: 'Yuki Tanaka', text: 'The rice is seasoned properly. As a Tokyo native, that is the highest compliment I can give.', extra: 'Sushi counter' },
        { title: 'Oliver Grant', text: 'The tonkotsu tastes like Fukuoka. I did not expect to find that here.', extra: 'Ramen bar' },
        { title: 'Nadia Suleiman', text: 'Omakase night was the best £60 I have spent on food in years.', extra: 'Counter regular' }
      ],
      price: [
        { icon: '🍜', title: 'Ramen', text: '£12–15', extra: 'Tonkotsu, shoyu or miso — walk-in', tag: '' },
        { icon: '🍣', title: 'Omakase', text: '£60', extra: '12 pieces + hand roll, chef’s choice', tag: 'Popular' },
        { icon: '🍶', title: 'Sake Flight', text: '£16', extra: 'Three pours matched to your meal', tag: '' }
      ],
      cta: { title: 'A seat at the counter', text: 'Six chairs, two sittings — book ahead or take your chances.' },
      gal: ['Nigiri at the counter', 'Tonkotsu ladled to order', 'The morning fish delivery', 'Omakase course', 'Ramen bar steam', 'Sake wall'],
      menu: {
        title: 'The menu', subtitle: 'Ramen bar is walk-in; the six-seat sushi counter is by booking.',
        cols: ['Dish', 'What it is', 'Price'],
        rows: [
          ['Tonkotsu Ramen', '18-hour pork broth, house noodles, chashu', '£14'],
          ['Shoyu Ramen', 'Clear chicken & fish broth, bamboo, nori', '£12'],
          ['Miso Ramen', 'Roasted corn, butter, spring onion', '£13'],
          ['Spicy Tuna Roll', 'Six pieces, toasted sesame', '£8'],
          ['Salmon Nigiri (2)', 'Cut to order over seasoned rice', '£7'],
          ['Chef’s Omakase', '12 pieces + hand roll, chef’s choice', '£60'],
          ['Gyoza (5)', 'Pork & cabbage, crispy bottom', '£6'],
          ['Matcha Cheesecake', 'Yuzu curd, white chocolate soil', '£7']
        ]
      }
    },
    {
      id: 'indian', name: 'Indian Kitchen', type: 'food',
      k: ['indian restaurant', 'indian food', 'curry house', 'curry', 'tandoori', 'biryani', 'punjabi', 'south indian', 'masala'],
      focus: 'Indian cooking',
      scenes: { hero: 'indian curry dishes spread', about: 'indian restaurant interior', gallery: 'indian food dishes' },
      t: [
        "{brand} — spices ground in-house, curries cooked to order, naan straight from the tandoor.",
        "Real Indian cooking is a matter of technique, not heat. {brand} has both.",
        "Family recipes, a proper tandoor, and spice blends ground every morning — welcome to {brand}."
      ],
      about: "{brand} runs on recipes from our grandmothers: spices bought whole and ground daily, curries cooked to order rather than sat in bains-marie, and a clay tandoor that has been seasoned since we opened. Our chefs come from Punjab and Kerala, and the menu crosses both — from charcoal-charred tandoori to coconut-scented coastal curries, with naan that never waits under a lamp.",
      aboutTitle: 'Ground daily, cooked to order',
      feat: [
        { icon: '🌶️', title: 'Spices Ground Daily', text: 'Whole spices bought weekly, ground in-house every morning — never pre-mixed.' },
        { icon: '🔥', title: 'A Real Tandoor', text: 'Clay oven fired with charcoal — naan, kebabs and tandoori charred properly.' },
        { icon: '🍛', title: 'Cooked to Order', text: 'No bains-marie. Every curry starts when you order it, the way it should.' },
        { icon: '🥥', title: 'Two Culinary Regions', text: 'Punjabi classics from the north, coconut curries and dosas from the south.' }
      ],
      stats: [
        { title: 'Spice blends', text: '22' }, { title: 'Tandoor temperature', text: '480°C' },
        { title: 'Family recipes', text: '40+' }, { title: 'Guest rating', text: '4.8★' }
      ],
      faqs: [
        { title: 'How spicy is the food?', text: 'Every dish is cooked mild by default and spiced to your level — from korma-gentle to vindaloo-properly.' },
        { title: 'Do you have vegan options?', text: 'A full vegan menu — dal makhani, chana masala, dosas and more. Ask for the separate vegan card.' },
        { title: 'Is the naan cooked in a tandoor?', text: 'Always. A real charcoal tandoor — that charred, blistered edge is the giveaway.' },
        { title: 'Do you deliver?', text: 'Yes — packed so curries travel upright and naan stays warm. Delivery nightly from 5pm.' }
      ],
      testis: [
        { title: 'Arjun Mehta', text: 'The dal makhani tastes like my grandmother’s. I have been chasing that for fifteen years.', extra: 'Punjabi reviewer' },
        { title: 'Rachel Stone', text: 'Finally, an Indian restaurant that does not hide its spice levels. The lamb rogan josh is elite.', extra: 'Verified review' },
        { title: 'Kavita Rao', text: 'As a south Indian, the dosa here made me emotional. Crisp, authentic, perfect.', extra: 'Weekly regular' }
      ],
      price: [
        { icon: '🍛', title: 'Curry Classics', text: '£10–14', extra: 'Butter chicken, rogan josh, saag paneer', tag: '' },
        { icon: '🔥', title: 'Tandoori Grill', text: '£13–18', extra: 'Charcoal-grilled, straight from the clay oven', tag: 'Popular' },
        { icon: '🍽️', title: 'Feast for Two', text: '£46', extra: 'Starter, curries, naan, rice & dessert', tag: '' }
      ],
      cta: { title: 'The tandoor is lit', text: 'Book a table — the naan waits for no one.' },
      gal: ['Butter chicken, finished', 'Naan from the tandoor', 'The spice wall at dawn', 'Dosa on the griddle', 'Tandoori platter', 'Biryani, dum-cooked'],
      menu: {
        title: 'The menu', subtitle: 'Cooked to order from family recipes — spice levels 1–5, your call.',
        cols: ['Dish', 'What it is', 'Price'],
        rows: [
          ['Butter Chicken', 'Tandoori chicken in tomato-makhani sauce', '£13'],
          ['Lamb Rogan Josh', 'Kashmiri chillies, slow-braised lamb', '£14'],
          ['Dal Makhani', 'Black lentils simmered overnight, cream & butter', '£10'],
          ['Saag Paneer', 'Home-made paneer in spiced greens', '£11'],
          ['Chicken Tikka', 'Charcoal tandoor, mint chutney', '£9'],
          ['Dosa (Masala)', 'Crisp fermented crepe, potato masala, sambar', '£9'],
          ['Garlic Naan', 'Charred in the tandoor', '£3.50'],
          ['Gulab Jamun (2)', 'Warm, rose syrup', '£5']
        ]
      }
    },
    {
      id: 'mexican', name: 'Mexican Taqueria', type: 'food',
      k: ['mexican', 'taqueria', 'taco', 'tacos', 'burrito', 'quesadilla', 'mexican food'],
      focus: 'tacos & Mexican cooking',
      scenes: { hero: 'street tacos spread', about: 'mexican taqueria interior', gallery: 'tacos and mexican food' },
      t: [
        "{brand} — corn ground for tortillas every morning, salsas that bite back.",
        "Slow-braised meats, handmade tortillas, and salsas with a sense of humour — {brand}.",
        "Real Mexican food starts at the tortilla. {brand} makes its own from scratch, daily."
      ],
      about: "{brand} is a taqueria in the Mexican tradition: nixtamalised corn ground fresh each morning for tortillas, meats braised overnight, and a salsa bar where the heat levels have opinions. Our barbacoa takes 14 hours, our al pastor spins on the trompo in the window, and every taco comes with two tortillas — the way it should. Ask for extra lime. You will not regret it.",
      aboutTitle: 'Tortillas from scratch',
      feat: [
        { icon: '🌽', title: 'Nixtamal Corn, Daily', text: 'Heirloom corn ground and pressed into tortillas every morning.' },
        { icon: '🥩', title: '14-Hour Barbacoa', text: 'Beef cheek braised overnight with guajillo and warm spices.' },
        { icon: '🔄', title: 'Trompo Al Pastor', text: 'Marinated pork spinning in the window, carved straight to your tortilla.' },
        { icon: '🌶️', title: 'Salsas That Bite', text: 'Roasted, green, smoky or stupid — four salsas made daily, heat level on the jar.' }
      ],
      stats: [
        { title: 'Tortillas / day', text: '1,400' }, { title: 'Barbacoa cook time', text: '14h' },
        { title: 'Salsa varieties', text: '4' }, { title: 'Taco rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'Do you make gluten-free tortillas?', text: 'Everything here is corn — naturally gluten-free. Just tell us about cross-contact at the counter.' },
        { title: 'How spicy is the salsa?', text: 'Three are friendly, one is called “The Regret”. Start with a toothpick’s worth.' },
        { title: 'Is there a vegetarian option?', text: 'The hongos taco — charred mushrooms, epazote, salsa verde — is a regular favourite.' },
        { title: 'Do you take bookings?', text: 'Mostly walk-in counter service, but groups of 8+ can reserve the back table.' }
      ],
      testis: [
        { title: 'Luis Herrera', text: 'The al pastor is carved right in front of you. Tastes like the DF, honestly.', extra: 'Mexico City native' },
        { title: 'Emma Walsh', text: 'The Regret salsa and I have a complicated relationship. The tacos are uncomplicated perfection.', extra: 'Regular' },
        { title: 'Tom Nguyen', text: 'Best tortillas I have eaten outside Mexico. You can taste the corn.', extra: 'Food writer' }
      ],
      price: [
        { icon: '🌮', title: 'Street Tacos', text: '£4 ea', extra: 'Al pastor, barbacoa, carnitas or hongos', tag: '' },
        { icon: '🍽️', title: 'Taco Feast', text: '£24', extra: 'Six tacos, rice & beans, salsa bar', tag: 'Popular' },
        { icon: '🥤', title: 'Agua Fresca', text: '£3.50', extra: 'Horchata, tamarind or Jamaica', tag: '' }
      ],
      cta: { title: 'Two tortillas, no regrets', text: 'The trompo is spinning from noon — walk in and order up.' },
      gal: ['Al pastor carving', 'Barbacoa, lifted', 'Fresh tortilla press', 'The salsa bar', 'Hongos taco', 'Horchata pour'],
      menu: {
        title: 'The menu', subtitle: 'Counter service — every taco arrives on two handmade corn tortillas.',
        cols: ['Taco', 'What is on it', 'Price'],
        rows: [
          ['Al Pastor', 'Spit-roasted pork, pineapple, onion, cilantro', '£4'],
          ['Barbacoa', '14-hour beef cheek, guajillo, salsa roja', '£4.50'],
          ['Carnitas', 'Slow-cooked pork, pickled onion, salsa verde', '£4'],
          ['Hongos', 'Charred mushrooms, epazote, crema', '£4'],
          ['Pescado', 'Crispy fish, cabbage slaw, chipotle mayo', '£4.50'],
          ['Quesadilla', 'Oaxaca cheese, your choice of filling', '£7'],
          ['Rice & Beans', 'The proper side', '£3.50'],
          ['Churros (3)', 'Cinnamon sugar, chocolate dip', '£4']
        ]
      }
    },
    {
      id: 'steakhouse', name: 'Steakhouse & Grill', type: 'food',
      k: ['steakhouse', 'steak house', 'steak', 'grill restaurant', 'bbq', 'barbecue', 'smokehouse', 'ribs', 'charcoal grill'],
      focus: 'properly grilled meat',
      scenes: { hero: 'grilled steak on flame', about: 'steakhouse interior', gallery: 'grill and steak dishes' },
      t: [
        "{brand} — dry-aged in-house, seared over real fire, rested and carved properly.",
        "Great steak is patience: ageing, fire, salt and rest. {brand} does all four.",
        "From 28-day dry-aged ribeye to whole-hog barbecue, {brand} respects the fire."
      ],
      about: "{brand} is a grill house built around one belief: meat deserves patience. We dry-age our beef in-house for a minimum of 28 days, sear it over an open charcoal and oak fire, and rest every cut longer than you think we should. The barbecue side of the menu is whole-animal — brisket that has smoked for 16 hours, pork shoulder pulled by hand, ribs with a bark that snaps. Bring a serious appetite and a loose schedule.",
      aboutTitle: 'Fire, age & patience',
      feat: [
        { icon: '🥩', title: 'Dry-Aged In-House', text: '28 to 60 days in our own ageing room — never bought pre-aged.' },
        { icon: '🔥', title: 'Real Fire, Real Wood', text: 'Charcoal and oak embers — seared, never fried, never grilled on gas.' },
        { icon: '🛢️', title: '16-Hour Brisket', text: 'Smoked low and slow, wrapped in butcher paper, rested like it matters.' },
        { icon: '🥔', title: 'Classic Sides, Done Right', text: 'Dripping-fat potatoes, creamed spinach and proper bone-marrow butter.' }
      ],
      stats: [
        { title: 'Dry-age minimum', text: '28 days' }, { title: 'Brisket smoke', text: '16h' },
        { title: 'Fire temperature', text: '600°C' }, { title: 'Guest rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'How do you cook the steaks?', text: 'Over a live charcoal and oak fire, to temperature, then rested on the bone. Rare-to-medium is the sweet spot for the dry-aged cuts.' },
        { title: 'Is there anything for non-meat eaters?', text: 'The wood-fired cauliflower with romesco and the smoked portobello are proper mains, not afterthoughts.' },
        { title: 'Do you take bookings?', text: 'Yes — and we recommend them for weekends. The counter seats by the fire are first come, first served.' },
        { title: 'What is the house special?', text: 'The 60-day dry-aged côte de boeuf for two, carved at the table with bone-marrow butter.' }
      ],
      testis: [
        { title: 'Graham Ellis', text: 'The 60-day côte de boeuf is the best steak of my life, and I have eaten in Buenos Aires.', extra: 'Regular' },
        { title: 'Sarah Connolly', text: 'Brisket with a bark that snaps and meat that pulls. That is barbecue, full stop.', extra: 'Verified review' },
        { title: 'Andre Duval', text: 'They rested my ribeye properly. You can taste the patience in every bite.', extra: 'Food critic' }
      ],
      price: [
        { icon: '🥩', title: 'Ribeye 300g', text: '£32', extra: '28-day dry-aged, fire-seared', tag: '' },
        { icon: '🔥', title: 'Côte de Boeuf', text: '£78', extra: '60-day aged, for two, carved at table', tag: 'Popular' },
        { icon: '🛢️', title: 'Brisket Plate', text: '£19', extra: '16-hour smoke, pickles, house bread', tag: '' }
      ],
      cta: { title: 'The fire is lit', text: 'Book a table by the open kitchen — the embers are at their best from 6pm.' },
      gal: ['Ribeye on the fire', 'The dry-age room', 'Brisket bark moment', 'Carving the côte de boeuf', 'Bone-marrow butter', 'Ribs off the smoker'],
      menu: {
        title: 'From the fire', subtitle: 'Steaks are cooked to temperature over charcoal and oak; barbecue is smoked until it surrenders.',
        cols: ['Cut', 'How it is handled', 'Price'],
        rows: [
          ['Ribeye 300g', '28-day dry-aged, bone-in option', '£32'],
          ['Sirloin 250g', '21-day aged, clean and beefy', '£24'],
          ['Fillet 200g', 'Tenderest cut, wrapped in bacon', '£29'],
          ['Côte de Boeuf', '60-day aged, for two, carved at table', '£78'],
          ['Smoked Brisket', '16 hours over oak, by weight', '£19'],
          ['Pork Belly Ribs', 'Half rack, sticky glaze', '£16'],
          ['Whole Cauliflower', 'Wood-fired, romesco, almonds', '£14'],
          ['Dripping-Fat Potatoes', 'Confit in beef fat, salt & rosemary', '£6']
        ]
      }
    },
    {
      id: 'florist', name: 'Florist & Flower Studio', type: 'retail',
      k: ['florist', 'flower shop', 'flower studio', 'floristry', 'wedding flowers', 'flowers', 'bouquet'],
      focus: 'hand-tied flowers',
      scenes: { hero: 'colorful flower bouquet', about: 'flower shop interior', gallery: 'flower arrangements' },
      t: [
        "{brand} — seasonal stems, hand-tied to order, no two bunches the same.",
        "Flowers should look like they grew that way. {brand} arranges them like they did.",
        "From doorstep bouquets to full wedding florals — {brand} works with the season, never against it."
      ],
      about: "{brand} started at a market stall with buckets of whatever the growers had that morning. That is still the rule: we buy from local growers within 24 hours of selling, build bouquets to order rather than from a fridge of wilting stock, and compost everything we do not sell. Weddings and events are planned months ahead, but the stems are always chosen the week of — when they are at their absolute best.",
      aboutTitle: 'Stems from local growers',
      feat: [
        { icon: '💐', title: 'Hand-Tied Bouquets', text: 'Wrapped to order — seasonal stems, no filler, no two alike.' },
        { icon: '🚚', title: 'Same-Day Delivery', text: 'Order by 1pm and your bouquet arrives that afternoon, in water.' },
        { icon: '💍', title: 'Wedding Florals', text: 'From single bouquets to full venue styling, planned around your date.' },
        { icon: '🌱', title: 'Grown, Not Flown', text: 'Local growers within a day’s drive — fresher stems, smaller footprint.' }
      ],
      stats: [
        { title: 'Local growers', text: '9' }, { title: 'Bouquets / week', text: '300+' },
        { title: 'Weddings styled', text: '40+' }, { title: 'Flower rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'How far ahead should I order?', text: 'Same-day for bouquets before 1pm. Weddings book months out; we take a few per weekend.' },
        { title: 'Do you deliver?', text: 'Local same-day delivery in a water wrap, or nationwide next-day by courier.' },
        { title: 'Can you match a colour scheme?', text: 'Send us a moodboard — we build around your palette using whatever is in season that week.' },
        { title: 'Do flowers come with a vase?', text: 'Bouquets arrive wrapped. Add a vase at checkout, or we can suggest one that suits the stems.' }
      ],
      testis: [
        { title: 'Imogen Rees', text: 'My wedding flowers looked like they had grown wild in the venue. I cried. So did my mum.', extra: 'Wedding client' },
        { title: 'Charlotte Webb', text: 'Ordered at 11am, bouquet at my mum’s door by 2pm. Made her entire week.', extra: 'Delivery' },
        { title: 'Nina Kowalski', text: 'The only florist in town that does not use baby’s breath as a personality.', extra: 'Regular' }
      ],
      price: [
        { icon: '💐', title: 'Bouquet', text: 'from £28', extra: 'Seasonal stems, hand-tied', tag: '' },
        { icon: '🏵️', title: 'Signature Bloom', text: 'from £55', extra: 'Larger stems, rare seasonal picks', tag: 'Popular' },
        { icon: '💍', title: 'Wedding Package', text: 'from £450', extra: 'Consultation, trials & the day itself', tag: '' }
      ],
      cta: { title: 'Send stems that mean it', text: 'Order by 1pm for same-day delivery — every bouquet built to order.' },
      gal: ['Studio buckets at dawn', 'Hand-tie in progress', 'Wedding aisle florals', 'Dried bouquet corner', 'Wrapping station', 'The compost bin (full cycle)']
    },
    {
      id: 'boutique', name: 'Fashion Boutique', type: 'retail',
      k: ['boutique', 'clothing store', 'fashion', 'clothing brand', 'womenswear', 'menswear', 'designer clothes', 'clothes shop', 'vintage clothing'],
      focus: 'curated fashion',
      scenes: { hero: 'fashion boutique clothing rack', about: 'boutique interior styled', gallery: 'fashion and clothing' },
      t: [
        "{brand} — a tightly edited rail of pieces you will wear for years, not seasons.",
        "We buy less, but better. {brand} curates fashion with an opinion.",
        "Small labels, natural fibres, honest prices. {brand} is the anti-fast-fashion rail."
      ],
      about: "{brand} began with a single rail in a corner shop and a rule we still keep: if we would not wear it weekly, we do not stock it. We buy from small European and local labels in small runs, favour natural fibres, and steam and re-style the floor daily so the shop feels like a well-dressed friend’s wardrobe. Everything is priced with the maker’s margin visible — transparency is the new luxury.",
      aboutTitle: 'The edit',
      feat: [
        { icon: '🧵', title: 'Small-Label Focus', text: 'Independent makers and local designers — never the same rails as everyone else.' },
        { icon: '🌿', title: 'Natural Fibres First', text: 'Linen, wool, cotton, silk. If it does not breathe, it does not come in.' },
        { icon: '👗', title: 'Personal Styling', text: 'Book a rail session — we pull pieces for your body, your wardrobe and your week.' },
        { icon: '✂️', title: 'Free Alterations', text: 'Every piece adjusted to fit in-house, included in the price.' }
      ],
      stats: [
        { title: 'Labels stocked', text: '24' }, { title: 'New arrivals / week', text: '2 drops' },
        { title: 'Client rating', text: '4.9★' }, { title: 'Alterations', text: 'Always free' }
      ],
      faqs: [
        { title: 'How does a styling session work?', text: 'Book 45 minutes, tell us your wardrobe gaps and budget, and we pull a rail for you to try. No pressure, ever.' },
        { title: 'What is your returns policy?', text: '14 days, full refund or exchange. Everything is steamed, checked and re-hung before it is resold.' },
        { title: 'Do you have a size range?', text: 'XS to XXL across the floor, and our alteration bench can tailor most pieces to your exact fit.' },
        { title: 'Is everything new?', text: 'Mostly new — plus a small pre-loved rail of curated vintage and archival pieces.' }
      ],
      testis: [
        { title: 'Freya Lindqvist', text: 'The styling session rebuilt my whole wardrobe around five pieces. Best money I have spent on clothes.', extra: 'Styling client' },
        { title: 'Georgia Lane', text: 'Bought a linen dress in March, wore it to two weddings and a funeral. Quality tells.', extra: 'Verified buyer' },
        { title: 'Marta Silva', text: 'Finally a shop where the staff say “that washes you out” instead of “that is so you”.', extra: 'Regular' }
      ],
      price: [
        { icon: '👕', title: 'Essentials', text: '£45–90', extra: 'Tops, tees and knitwear that earn their place', tag: '' },
        { icon: '🧥', title: 'The Rail', text: '£120–280', extra: 'Tailoring, outerwear and dresses', tag: 'Popular' },
        { icon: '👗', title: 'Statement', text: '£280+', extra: 'Limited runs and archival pieces', tag: '' }
      ],
      cta: { title: 'Fewer, better pieces', text: 'Book a styling session or just come browse the rail — the kettle is always on.' },
      gal: ['The edit this week', 'Linen rail at golden hour', 'Styling session', 'Alteration bench', 'Pre-loved corner', 'New drop unboxing']
    },
    {
      id: 'hair', name: 'Hair Salon', type: 'beauty',
      k: ['hair salon', 'hairdresser', 'hair studio', 'hair stylist', 'haircut', 'colourist', 'balayage', 'hair colour', 'cut and colour'],
      focus: 'cut & colour',
      scenes: { hero: 'hairstylist styling hair salon', about: 'hair salon interior', gallery: 'hair colour and styling' },
      t: [
        "{brand} — a proper consultation, a considered cut, and colour that grows out like it was planned.",
        "Great hair is 80% consultation. {brand} does the listening part properly.",
        "Cut, colour and care — {brand} is the salon your hair has been asking for."
      ],
      about: "{brand} was built on a simple gripe: salons that rush the consultation and chase the trend. Ours is the opposite — every appointment starts with ten unhurried minutes about your hair history, your routine, and how much effort you actually want to spend. Our colourists train on live models monthly, we use ammonia-free colour, and every cut is finished with a style lesson so it looks this good at home.",
      aboutTitle: 'Consultation first',
      feat: [
        { icon: '💬', title: 'Real Consultations', text: 'Ten unhurried minutes before every service — about you, not trends.' },
        { icon: '🎨', title: 'Trained Colourists', text: 'Monthly live-model training and ammonia-free colour as standard.' },
        { icon: '💇', title: 'A Cut That Grows', text: 'Shape first, trend second — your cut still looks right in eight weeks.' },
        { icon: '🏠', title: 'Style Lessons', text: 'Every finish includes a how-to, so it never looks worse at home.' }
      ],
      stats: [
        { title: 'Stylists', text: '11' }, { title: 'Client rating', text: '4.9★' },
        { title: 'Colour training / yr', text: '12' }, { title: 'Ammonia-free', text: 'Always' }
      ],
      faqs: [
        { title: 'How do I book?', text: 'Online in under a minute, or call the front desk. Most stylists book two to three weeks ahead.' },
        { title: 'Do you offer free consultations?', text: 'Yes — a 15-minute colour consultation is free, with swatches on your own hair before you commit.' },
        { title: 'What if I hate it?', text: 'Tell us within seven days and we will fix it free. It has happened twice in nine years.' },
        { title: 'Do you do wedding hair?', text: 'Trials, on-the-day styling and group bookings — book trials at least six weeks before the date.' }
      ],
      testis: [
        { title: 'Olivia Marsh', text: 'My balayage grew out so cleanly people asked where I had been — again. That is the sign of a real colourist.', extra: 'Colour client' },
        { title: 'Diana Petrova', text: 'They taught me how to actually style my own hair. Life changing, honestly.', extra: 'Cut client' },
        { title: 'Hannah Liu', text: 'Wedding hair trial made me cry happy tears. Booked the whole bridal party.', extra: 'Bridal client' }
      ],
      price: [
        { icon: '✂️', title: 'Cut & Finish', text: '£52', extra: 'Consultation, wash, cut, style lesson', tag: '' },
        { icon: '🎨', title: 'Colour', text: 'from £90', extra: 'Balayage, gloss or full colour', tag: 'Popular' },
        { icon: '💍', title: 'Bridal', text: 'from £120', extra: 'Trial + on-the-day styling', tag: '' }
      ],
      cta: { title: 'Your best hair is one appointment away', text: 'Book online — consultation included in every service.' },
      gal: ['Balayage in progress', 'The consultation chair', 'Fresh cut, styled', 'Colour swatches on hair', 'Bridal updo', 'Backwash hour']
    },
    {
      id: 'barber', name: 'Barbershop', type: 'beauty',
      k: ['barber', 'barbershop', 'barber shop', 'barbering', 'fade', 'beard trim', 'hot towel shave', 'traditional barber'],
      focus: 'traditional barbering',
      scenes: { hero: 'barber cutting hair in barbershop', about: 'barbershop interior chairs', gallery: 'barbering and beard care' },
      t: [
        "{brand} — sharp fades, honest opinions and a hot towel you will dream about.",
        "The traditional barbershop is not nostalgia — it is standards. {brand} keeps both.",
        "Walk in for a cut, stay for the conversation. {brand} — barbering since the old school way."
      ],
      about: "{brand} is a proper barbershop: leather chairs, straight razors, and barbers who trained for years rather than watched a weekend course. We cut all hair textures and all ages — from skin fades to schoolboy tidy-ups — and finish every appointment with a hot towel and a neck shave because that is how it should be. The coffee is strong, the chat is optional, and the chair is yours for as long as the cut takes.",
      aboutTitle: 'The old-school way',
      feat: [
        { icon: '💈', title: 'Proper Training', text: 'Apprenticeship-trained barbers — not weekend-course graduates.' },
        { icon: '🪒', title: 'Razor Finish', text: 'Hot towel and open-blade neck shave on every cut, always.' },
        { icon: '🧔', title: 'Beard Work', text: 'Shaped, not just trimmed — with oil and balm to take home.' },
        { icon: '👦', title: 'All Ages, All Textures', text: 'From skin fades to first cuts — trained across every hair type.' }
      ],
      stats: [
        { title: 'Barbers', text: '7' }, { title: 'Hot towels / day', text: '140' },
        { title: 'Years in the chair', text: '65+' }, { title: 'Client rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'Do I need to book?', text: 'Walk-ins welcome, but Friday and Saturday book out. Most cuts take 30–45 minutes.' },
        { title: 'Can you cut curly or textured hair?', text: 'Yes — three of our barbers specialise in textured hair. Book with them directly.' },
        { title: 'Is a hot towel shave worth it?', text: 'Try one and you will never ask again. Open blade, three passes, zero razor burn.' },
        { title: 'Do you cut children’s hair?', text: 'First cuts are our favourite — we go slowly, and the lollipop is mandatory.' }
      ],
      testis: [
        { title: 'Michael O’Brien', text: 'Left my old barber of ten years after one visit here. The razor finish is non-negotiable now.', extra: 'Regular' },
        { title: 'Kwame Mensah', text: 'Finally found a shop that actually knows how to cut textured hair. Worth the wait list.', extra: 'Textured cut' },
        { title: 'Tom’s Dad, Dave', text: 'They gave my four-year-old his first proper cut. He sat like a saint. Miracles happen.', extra: 'First cut' }
      ],
      price: [
        { icon: '💈', title: 'Skin Fade', text: '£26', extra: 'Cut, hot towel, razor finish', tag: '' },
        { icon: '🧔', title: 'Cut & Beard', text: '£38', extra: 'Hair and beard shaped together', tag: 'Popular' },
        { icon: '🪒', title: 'Royal Shave', text: '£28', extra: 'Hot towels, open blade, facial', tag: '' }
      ],
      cta: { title: 'The chair is ready', text: 'Book online or walk in — the kettle is always on.' },
      gal: ['Skin fade in progress', 'The razor finish', 'Beard shaping', 'Leather chairs at opening', 'First cut ceremony', 'Sundays: walk-ins only']
    },
    {
      id: 'nails', name: 'Nail Studio', type: 'beauty',
      k: ['nail salon', 'nail studio', 'nails', 'manicure', 'pedicure', 'nail art', 'gel nails', 'acrylics', 'nail tech'],
      focus: 'nail artistry',
      scenes: { hero: 'nail art manicure close up', about: 'nail salon interior', gallery: 'nail designs' },
      t: [
        "{brand} — healthy nails first, beautiful nails always.",
        "Your nails are tiny canvases. {brand} treats them that way.",
        "Clean, precise and kind to your natural nail — {brand} nail studio."
      ],
      about: "{brand} was founded by two nail techs who were tired of seeing over-filed, damaged natural nails walk out of salons. Every appointment here starts with a health check of your natural nail, we use only HEMA-free gels and acetone-free removal, and our nail art bench has more colours than we will ever admit. Extensions are an occasional treat, not a lifestyle — and we will tell you so.",
      aboutTitle: 'Healthy first, beautiful always',
      feat: [
        { icon: '💅', title: 'HEMA-Free Gels', text: 'Gentler formulas, and acetone-free removal as standard.' },
        { icon: '🖌️', title: 'Real Nail Art', text: 'Hand-painted detail and 3D work — not just a foil stamp and a prayer.' },
        { icon: '🧴', title: 'Nail Health First', text: 'A natural-nail check and cuticle care before any product goes on.' },
        { icon: '📅', title: 'Same-Day Booking', text: 'Online booking with a 24-hour free-cancellation window.' }
      ],
      stats: [
        { title: 'Nail techs', text: '6' }, { title: 'Colours on the wall', text: '400+' },
        { title: 'Client rating', text: '4.9★' }, { title: 'Removal method', text: 'Acetone-free' }
      ],
      faqs: [
        { title: 'How long do gel nails last?', text: 'Two to three weeks with proper aftercare — we show you exactly how to make them last.' },
        { title: 'Will this damage my natural nails?', text: 'No — we only work on healthy nails and remove product properly. If your nails need a break, we will tell you.' },
        { title: 'Do you do nail art?', text: 'From minimalist lines to full hand-painted scenes — the art bench is our pride.' },
        { title: 'Can I book a group?', text: 'Yes — hen dos and birthday groups of up to six can take the back tables together.' }
      ],
      testis: [
        { title: 'Jess Turner', text: 'My natural nails are longer now than before I started getting gels. That never happened anywhere else.', extra: 'Regular' },
        { title: 'Amelia Fox', text: 'Asked for “something witchy but office-safe” and got exactly that. The art bench is magic.', extra: 'Nail art' },
        { title: 'Ruth Daniels', text: 'Booked a hen party of five — they were so patient and the nails were flawless.', extra: 'Group booking' }
      ],
      price: [
        { icon: '💅', title: 'Gel Manicure', text: '£38', extra: 'Health check, cuticle care, gel colour', tag: '' },
        { icon: '🖌️', title: 'Art Add-On', text: '+£8–20', extra: 'Hand-painted detail, per design', tag: 'Popular' },
        { icon: '✨', title: 'Luxury Pedicure', text: '£48', extra: 'Soak, scrub, mask, gel colour', tag: '' }
      ],
      cta: { title: 'Your hands deserve the good chair', text: 'Book online — healthy nails, beautiful nails, both.' },
      gal: ['The colour wall', 'Hand-painted florals', 'Gel application', 'Cuticle care close-up', 'Hen party table', 'The art bench']
    },
    {
      id: 'spa', name: 'Day Spa & Wellness', type: 'beauty',
      k: ['day spa', 'spa', 'massage', 'massage therapy', 'wellness centre', 'skincare clinic', 'facial', 'facials', 'holistic', 'sauna'],
      focus: 'wellness treatments',
      scenes: { hero: 'spa treatment room candles', about: 'spa interior towels', gallery: 'spa and wellness' },
      t: [
        "{brand} — treatments that slow you down properly, not just for an hour.",
        "Calm is the treatment. {brand} simply provides the room, the hands and the time.",
        "From deep-tissue to deep calm — {brand} wellness spa."
      ],
      about: "{brand} was designed around one idea: you should not have to explain why you are tired. Our therapists are qualified in both relaxation and clinical massage, our facials are prescribed by skin type rather than sold as packages, and every visit starts in the relaxation lounge with tea and silence. No upselling mid-treatment, no clocks on the wall, no guilt about the phone you left in the locker.",
      aboutTitle: 'Designed around calm',
      feat: [
        { icon: '🤲', title: 'Qualified Therapists', text: 'Clinical and relaxation trained — the same therapist, every visit.' },
        { icon: '🧖', title: 'Relaxation Lounge', text: 'Every treatment begins and ends here, with tea and actual silence.' },
        { icon: '🌿', title: 'Prescribed Facials', text: 'Your skin decides the facial — no packages, no upselling mid-treatment.' },
        { icon: '🧖‍♀️', title: 'Couples & Groups', text: 'Twin treatment rooms for couples, and group packages for real friends.' }
      ],
      stats: [
        { title: 'Therapists', text: '9' }, { title: 'Treatment rooms', text: '7' },
        { title: 'Client rating', text: '4.9★' }, { title: 'Upsells per visit', text: '0' }
      ],
      faqs: [
        { title: 'Which massage should I book?', text: 'Tight shoulders and desk life — deep tissue. Need to switch off — Swedish or hot stone. Not sure — book the consultation massage.' },
        { title: 'Do I need to arrive early?', text: 'Fifteen minutes, so you can change, use the lounge and actually slow down before your treatment.' },
        { title: 'Are your products safe for sensitive skin?', text: 'We work with a dermatologist-approved, fragrance-free range and patch test if there is any doubt.' },
        { title: 'What is your late policy?', text: 'Arriving late shortens your treatment, not the next guest’s. We protect everyone’s time equally.' }
      ],
      testis: [
        { title: 'Helen Carter', text: 'I fell asleep during the facial. Twice. That has never happened to me anywhere.', extra: 'Spa member' },
        { title: 'Priya Sharma', text: 'Deep tissue that actually fixed a six-month shoulder problem. Qualified hands make the difference.', extra: 'Massage client' },
        { title: 'Emma Hart', text: 'No upselling, no clock, no guilt. The lounge alone is worth the price of admission.', extra: 'Regular' }
      ],
      price: [
        { icon: '🤲', title: 'Massage', text: '£65', extra: 'Swedish, deep tissue or hot stone, 60 min', tag: '' },
        { icon: '🌿', title: 'Signature Facial', text: '£85', extra: 'Skin-prescribed, 75 minutes', tag: 'Popular' },
        { icon: '🍵', title: 'Half-Day Calm', text: '£140', extra: 'Massage + facial + lounge + tea', tag: '' }
      ],
      cta: { title: 'Your calm is waiting', text: 'Book online — the lounge is warm and the kettle is on.' },
      gal: ['The relaxation lounge', 'Treatment room at dusk', 'Hot stone ritual', 'Facial room', 'Couples suite', 'Tea & silence corner']
    },
    {
      id: 'gym', name: 'Gym & Personal Training', type: 'fitness',
      k: ['gym', 'personal trainer', 'crossfit', 'fitness studio', 'strength training', 'bootcamp', 'weightlifting', 'functional fitness', 'workout'],
      focus: 'strength & fitness',
      scenes: { hero: 'athlete lifting weights gym', about: 'modern gym floor', gallery: 'strength training' },
      t: [
        "{brand} — coaching first, equipment second, ego nowhere.",
        "The best programme is the one you actually stick to. {brand} builds that one.",
        "Stronger every session, not just every January — {brand} gym & coaching."
      ],
      about: "{brand} is a coaching-led gym: every member starts with a movement assessment, every programme is written for your body and your schedule, and every coach is qualified beyond the minimum. We keep class sizes small enough that your name is known, check your technique before we add your load, and measure progress in things that matter — pain-free movement, better sleep, lifts that keep climbing. No intimidation, no judgement, no shortcuts.",
      aboutTitle: 'Coaching-led training',
      feat: [
        { icon: '📋', title: 'Movement Assessment', text: 'Every member starts with a full assessment — then a programme built for you.' },
        { icon: '👥', title: 'Small Classes', text: 'Capped so your coach knows your name, your lifts and your limitations.' },
        { icon: '📈', title: 'Progress That Tracks', text: 'Lifts, mobility and sleep logged — results you can see, not guess.' },
        { icon: '🕒', title: 'Open From 6am', text: 'Coaching from 6am to 9pm, plus 24/7 member access.' }
      ],
      stats: [
        { title: 'Coaches', text: '8' }, { title: 'Class cap', text: '14' },
        { title: 'Member rating', text: '4.9★' }, { title: 'Open hours', text: '6am–9pm' }
      ],
      faqs: [
        { title: 'I am a complete beginner — is this for me?', text: 'Especially for you. Beginners get the assessment, a fundamentals block and a coach who checks in every session.' },
        { title: 'Is there a contract?', text: 'No lock-in — month to month, cancel with 30 days notice. We keep members with results, not paperwork.' },
        { title: 'What does a class look like?', text: 'A proper warm-up, coached skill work, a strength or conditioning session, and a cool-down. Never just “do as many rounds as possible”.' },
        { title: 'Do you offer personal training?', text: 'Yes — one-to-one blocks of 6 or 12 sessions, programmed and reviewed with a specific coach.' }
      ],
      testis: [
        { title: 'Marcus Bell', text: 'Down 14kg and my deadlift is up 60kg. The coaching, not the equipment, did that.', extra: 'Member, 2 years' },
        { title: 'Elena Garcia', text: 'First gym where nobody has ever made me feel small. The assessment sold me.', extra: 'Member, 6 months' },
        { title: 'Josh Whitaker', text: 'My programme knows my knee, my job and my travel schedule. It feels personal because it is.', extra: 'PT client' }
      ],
      price: [
        { icon: '🎟️', title: 'Day Pass', text: '£12', extra: 'Full floor, induction included', tag: '' },
        { icon: '🔥', title: 'Unlimited', text: '£55/mo', extra: 'Classes + floor + app programming', tag: 'Popular' },
        { icon: '🏋️', title: 'With Coaching', text: '£95/mo', extra: 'Unlimited + monthly 1:1 programming', tag: '' }
      ],
      cta: { title: 'Your first session is coached, free', text: 'Come move with us — no pressure, no contract, no judgement.' },
      gal: ['Movement assessment', 'Deadlift coaching', '6am class', 'Mobility work', 'Member milestones board', 'The chalk bucket']
    },
    {
      id: 'yoga', name: 'Yoga & Movement Studio', type: 'fitness',
      k: ['yoga', 'yoga studio', 'pilates', 'pilates studio', 'meditation', 'mindfulness', 'reformer'],
      focus: 'yoga & mindful movement',
      scenes: { hero: 'yoga class in bright studio', about: 'yoga studio interior mats', gallery: 'yoga practice' },
      t: [
        "{brand} — movement classes where the point is how you feel afterwards, not how you look mid-pose.",
        "Leave your ego at the door and your phone in the cubby. {brand} yoga & movement.",
        "Stronger, softer, steadier — {brand} builds practice you can actually live."
      ],
      about: "{brand} is a warm, natural-light studio offering vinyasa, yin and reformer pilates in classes small enough that hands-on adjustments happen. Every teacher here has at least 500 hours of training, and every class is sequenced around the bodies in the room rather than a script. Beginners are genuinely welcome — we will show you ten variations of every pose and none of them are “the easy one”.",
      aboutTitle: 'Practice, not performance',
      feat: [
        { icon: '🧘', title: '500-Hour Teachers', text: 'Every teacher trained beyond the minimum — hands-on, thoughtful, precise.' },
        { icon: '🤸', title: 'All-Levels Sequencing', text: 'Ten variations per pose, offered without judgment or “the easy one”.' },
        { icon: '🌅', title: 'Morning & Evening', text: 'Classes from 6.30am to 9pm — practice when your body asks for it.' },
        { icon: '🧖', title: 'Real Adjustments', text: 'Small classes and actual hands-on support, not a voice calling cues from the front.' }
      ],
      stats: [
        { title: 'Classes / week', text: '45' }, { title: 'Class cap', text: '16' },
        { title: 'Teacher training', text: '500h+' }, { title: 'Studio rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'I have never done yoga — will I cope?', text: 'Our fundamentals course exists exactly for you: six weeks, small group, zero prior flexibility required.' },
        { title: 'What should I bring?', text: 'Just yourself — mats, blocks, straps and towels are all here and cleaned after every class.' },
        { title: 'Is pilates the same as yoga?', text: 'Different tools, same principle: controlled movement with attention. Try both with a multi-class pass and decide.' },
        { title: 'Can I book a private session?', text: 'Yes — one-to-one or duo sessions for recovery, sport or just learning at your own pace.' }
      ],
      testis: [
        { title: 'Kate Fellows', text: 'I came for my back, stayed for the quiet hour of my week. The adjustments are wonderful.', extra: 'Member, 1 year' },
        { title: 'Rachel Green', text: 'First studio where I did not feel judged for being inflexible. Fundamentals changed everything.', extra: 'Fundamentals grad' },
        { title: 'Samir Patel', text: 'Reformer pilates here rebuilt my core after a back injury. Professional and patient.', extra: 'Pilates client' }
      ],
      price: [
        { icon: '🎟️', title: 'Drop-In', text: '£14', extra: 'Any class, mat included', tag: '' },
        { icon: '🧘', title: 'Unlimited', text: '£79/mo', extra: 'All yoga + pilates classes', tag: 'Popular' },
        { icon: '🧑‍🏫', title: 'Private', text: '£55', extra: 'One-to-one, your goals', tag: '' }
      ],
      cta: { title: 'Your mat is waiting', text: 'Book a class — beginners and bendy people both welcome.' },
      gal: ['Morning vinyasa', 'Hands-on adjustment', 'Yin room at dusk', 'Reformer studio', 'Fundamentals cohort', 'Tea after class']
    },
    {
      id: 'interior', name: 'Interior Design Studio', type: 'home',
      k: ['interior design', 'interior designer', 'interior design studio', 'home styling', 'room redesign', 'kitchen design', 'bathroom design'],
      focus: 'considered interiors',
      scenes: { hero: 'bright designed living room interior', about: 'interior designer moodboard', gallery: 'interior design projects' },
      t: [
        "{brand} — rooms designed around how you actually live, not how they look in a render.",
        "Good interiors start with how you live. {brand} designs from there.",
        "From full renovations to one perfect room — {brand} interior design."
      ],
      about: "{brand} is a small interior design practice with a stubborn process: we interview how you live before we sketch a single wall. Every project starts with a lifestyle audit — how you cook, work, host and sleep — and the design follows. We handle full renovations, single-room transformations and everything between, with fixed fees agreed up front and a sourcing service that keeps the budget honest.",
      aboutTitle: 'Designed around your life',
      feat: [
        { icon: '📐', title: 'Lifestyle-First Design', text: 'A lifestyle audit before any sketch — rooms built around how you live.' },
        { icon: '💷', title: 'Fixed Fees', text: 'Agreed in writing before work starts. No hourly surprises, ever.' },
        { icon: '🛋️', title: 'Full-Service Sourcing', text: 'From joinery to cushions — we source, order and manage everything.' },
        { icon: '🔨', title: 'Renovation Management', text: 'We run the builders, the schedule and the snag list so you do not have to.' }
      ],
      stats: [
        { title: 'Projects completed', text: '140+' }, { title: 'Rooms designed', text: '400+' },
        { title: 'Client rating', text: '4.9★' }, { title: 'Budget variance', text: '<5%' }
      ],
      faqs: [
        { title: 'How much does a project cost?', text: 'Room transformations from £2,500 fixed; full renovations from £12,000. The first consultation is free and detailed.' },
        { title: 'Can you work with my existing furniture?', text: 'Happily — we design around pieces you love and only recommend replacing what does not earn its place.' },
        { title: 'Do you manage the builders?', text: 'For renovations, yes — we run the schedule, the trades and the snagging list. You approve, we manage.' },
        { title: 'How long does a room take?', text: 'Design and sourcing typically 6–8 weeks; renovations 8–16 weeks depending on scope.' }
      ],
      testis: [
        { title: 'Aisha Rahman', text: 'They asked how we actually lived — then delivered a kitchen that fits our chaos perfectly.', extra: 'Kitchen renovation' },
        { title: 'Daniel Brooks', text: 'Fixed fee, on schedule, and the snag list was shorter than our last builder’s quote.', extra: 'Full renovation' },
        { title: 'Sarah Mitchell', text: 'One room, £2,800, and it changed how the whole house feels. Worth every penny.', extra: 'Room transformation' }
      ],
      price: [
        { icon: '🛋️', title: 'Room Design', text: 'from £2,500', extra: 'Concept, sourcing, styling', tag: '' },
        { icon: '🏠', title: 'Full Renovation', text: 'from £12,000', extra: 'Design + project management', tag: 'Popular' },
        { icon: '💬', title: 'Consultation', text: 'Free', extra: '90 minutes, in your home', tag: '' }
      ],
      cta: { title: 'Let’s talk about how you live', text: 'Book a free 90-minute consultation — we will bring the moodboards.' },
      gal: ['Kitchen before & after', 'Living room concept', 'Joinery detail', 'Material board', 'Bedroom transformation', 'Snag-free handover']
    },
    {
      id: 'cleaning', name: 'Professional Cleaning', type: 'home',
      k: ['cleaning service', 'cleaners', 'house cleaning', 'office cleaning', 'deep clean', 'end of tenancy cleaning', 'commercial cleaning', 'domestic cleaning'],
      focus: 'professional cleaning',
      scenes: { hero: 'clean bright home interior', about: 'professional cleaner at work', gallery: 'clean spaces' },
      t: [
        "{brand} — the same trusted cleaner every visit, insured, vetted and obsessive about the skirting boards.",
        "A clean home is a calm home. {brand} delivers both, on schedule.",
        "Vetted cleaners, transparent pricing, and a checklist you can see — {brand} cleaning."
      ],
      about: "{brand} was started by a former hotel housekeeping supervisor who was tired of agencies swapping strangers into her clients’ homes. Our rule is simple: you get the same vetted, insured cleaner every visit, booked through an app with a checklist you can see live. No agency roulette, no mystery fees, and if anything is not right we re-clean within 48 hours free.",
      aboutTitle: 'The same trusted face',
      feat: [
        { icon: '🛡️', title: 'Same Cleaner, Always', text: 'Vetted, insured and consistent — never agency roulette.' },
        { icon: '✅', title: 'Checklist You Can See', text: 'A live checklist after every visit — what was cleaned, what needs attention.' },
        { icon: '🧽', title: 'Eco Products Standard', text: 'Child- and pet-safe products on every clean unless you ask otherwise.' },
        { icon: '🔁', title: '48-Hour Guarantee', text: 'Not happy with a corner? We re-clean free within 48 hours.' }
      ],
      stats: [
        { title: 'Cleaners vetted', text: '60+' }, { title: 'Homes cleaned / wk', text: '340' },
        { title: 'Client rating', text: '4.8★' }, { title: 'Re-clean rate', text: '<1%' }
      ],
      faqs: [
        { title: 'Do I need to be home?', text: 'No — most clients share a key or code. Your cleaner is the same person every visit and fully insured.' },
        { title: 'What is included in a standard clean?', text: 'Kitchen, bathrooms, floors, dusting and surfaces — the full checklist is on our site and agreed before booking.' },
        { title: 'Can I book a one-off deep clean?', text: 'Yes — spring cleans and end-of-tenancy cleans are our speciality. Quote online in 30 seconds.' },
        { title: 'What if I need to cancel?', text: 'Free cancellation up to 24 hours before. After that, we still try to fill the slot.' }
      ],
      testis: [
        { title: 'Joanne Miles', text: 'Same cleaner for two years. She knows my house better than I do — in the best way.', extra: 'Weekly client' },
        { title: 'David Chen', text: 'End-of-tenancy clean got my full deposit back. The agent actually complimented the state.', extra: 'Deep clean' },
        { title: 'Laura Bell', text: 'The live checklist is genius. I can see exactly what was done and nothing is a mystery.', extra: 'New client' }
      ],
      price: [
        { icon: '🏠', title: 'Standard', text: '£30/h', extra: 'Minimum 2 hours, same cleaner', tag: '' },
        { icon: '✨', title: 'Deep Clean', text: 'from £180', extra: 'One-off, whole home, quoted online', tag: 'Popular' },
        { icon: '🔑', title: 'Weekly', text: 'from £25/h', extra: 'Regular booking, priority slots', tag: '' }
      ],
      cta: { title: 'A cleaner home, without the juggling', text: 'Get your instant quote — book in under two minutes.' },
      gal: ['Sparkling kitchen', 'The checklist in action', 'Deep clean squad', 'Eco products shelf', 'End-of-tenancy result', 'Bathroom gloss']
    },
    {
      id: 'wedding', name: 'Wedding Planning Studio', type: 'events',
      k: ['wedding planner', 'wedding planning', 'weddings', 'wedding', 'bridal', 'elopement', 'wedding coordinator', 'destination wedding'],
      focus: 'weddings',
      scenes: { hero: 'elegant wedding ceremony', about: 'wedding venue styling', gallery: 'wedding details' },
      t: [
        "{brand} — weddings planned around the two of you, not the Pinterest board.",
        "Your wedding should feel like you, not like everyone else’s. {brand} makes that true.",
        "From first venue visit to last dance — {brand} holds the details so you can hold each other."
      ],
      about: "{brand} is a wedding planning studio built on a belief we defend daily: a wedding is a party for your people, hosted by the two of you — not a production for an audience. We plan full weddings, partial planning and day-of coordination across the region, working with venues and suppliers we have vetted over hundreds of weddings. Every couple gets one lead planner, a budget that is respected, and a timeline that actually runs on the day.",
      aboutTitle: 'Planned around you',
      feat: [
        { icon: '💍', title: 'One Lead Planner', text: 'The person you meet is the person running your day — no hand-offs.' },
        { icon: '💰', title: 'Budget Kept Honest', text: 'A live budget tool and suppliers who have quoted fairly for years.' },
        { icon: '📋', title: 'Full-Timeline Management', text: 'From venue search to last dance — every supplier, every minute.' },
        { icon: '🆘', title: 'Day-Of Calm', text: 'You have nothing to do but get married. We handle every hiccup.' }
      ],
      stats: [
        { title: 'Weddings planned', text: '120+' }, { title: 'Vetted suppliers', text: '80+' },
        { title: 'Couple rating', text: '4.9★' }, { title: 'Panicked calls on the day', text: 'Zero' }
      ],
      faqs: [
        { title: 'How far ahead should we book?', text: 'Peak-season Saturdays book 12–18 months out. Day-of coordination can often be added closer.' },
        { title: 'What does partial planning include?', text: 'Venue shortlist, supplier recommendations, budget tracking and a full run-sheet — you handle the choices, we handle the logistics.' },
        { title: 'Can you work with our budget?', text: 'We plan everything from intimate elopements to 150-guest weddings — the first call is about your budget, not ours.' },
        { title: 'Are you LGBTQ+ friendly?', text: 'Unequivocally. Every couple, every combination, every ceremony.' }
      ],
      testis: [
        { title: 'Sophie & Rachel', text: 'Our lead planner handled a caterer crisis without us even noticing. That is the job, done properly.', extra: 'Full planning' },
        { title: 'Tom & Ellie', text: 'The budget tool kept us honest and the day ran like clockwork. Worth every penny.', extra: 'Partial planning' },
        { title: 'Hannah & Dave', text: 'They made our small, weird, wonderful wedding exactly that. Never once tried to Pinterest it up.', extra: 'Intimate wedding' }
      ],
      price: [
        { icon: '📋', title: 'Day-Of Coordination', text: 'from £650', extra: 'Run-sheet + calm on the day', tag: '' },
        { icon: '💍', title: 'Partial Planning', text: 'from £1,800', extra: 'Venues, suppliers, budget, timeline', tag: 'Popular' },
        { icon: '✨', title: 'Full Planning', text: 'from £3,500', extra: 'Everything, from first visit to last dance', tag: '' }
      ],
      cta: { title: 'Tell us about your people', text: 'Book a free consultation — bring your budget and your wildest idea.' },
      gal: ['Ceremony styling', 'Table setting detail', 'First dance hour', 'Venue walkthrough', 'Supplier tasting table', 'The run-sheet board']
    },
    {
      id: 'photography', name: 'Photography Studio', type: 'creative',
      k: ['photography', 'photographer', 'photo studio', 'portrait photography', 'wedding photography', 'product photography', 'commercial photography'],
      focus: 'photography',
      scenes: { hero: 'photographer camera studio', about: 'photography studio lights', gallery: 'photography work' },
      t: [
        "{brand} — photographs that look like the moment felt, not like a pose held.",
        "Real moments, properly lit, delivered on time. {brand} photography.",
        "From portraits to products — {brand} makes images that work as hard as you do."
      ],
      about: "{brand} is a photography studio run by two shooters with fifteen years between us. We photograph people, products and places — and we do the whole job: direction that puts subjects at ease, lighting that flatters honestly rather than filters everything, and post-production that is finished in days, not weeks. Every session includes a proper pre-call, a shot list we agree together, and galleries delivered with full usage rights.",
      aboutTitle: 'Direction to delivery',
      feat: [
        { icon: '📷', title: 'Real Direction', text: 'Subjects at ease, poses that fit real people — no “now look surprised”.' },
        { icon: '💡', title: 'Honest Lighting', text: 'Flattering and true — not a filter slapped on in post.' },
        { icon: '⏱️', title: 'Fast Delivery', text: 'Edited galleries in days, not weeks — with full usage rights.' },
        { icon: '🎯', title: 'Shot Lists, Agreed', text: 'Every session starts with a pre-call and a shot list you approve.' }
      ],
      stats: [
        { title: 'Sessions / year', text: '180+' }, { title: 'Years shooting', text: '15' },
        { title: 'Client rating', text: '4.9★' }, { title: 'Avg. delivery', text: '5 days' }
      ],
      faqs: [
        { title: 'What should we wear for a session?', text: 'We send a full prep guide after booking — but the short answer is: solid colours, no big logos, layers help.' },
        { title: 'Do we get the raw files?', text: 'No — you get every edited image in high resolution with full usage rights. Raw files are our craft, edits are yours.' },
        { title: 'How does product photography work?', text: 'Send a moodboard and we handle styling, lighting and retouching — most product shoots deliver within a week.' },
        { title: 'Do you travel?', text: 'Yes — destination weddings and brand shoots worldwide. Travel costs are quoted transparently up front.' }
      ],
      testis: [
        { title: 'Charlotte Reed', text: 'He made my awkward husband look like a magazine cover. Witchcraft, or just very good direction.', extra: 'Family session' },
        { title: 'Owen Mills', text: 'Product shots that doubled our conversion. The retouching is surgical.', extra: 'E-commerce brand' },
        { title: 'Priya & Arjun', text: 'Gallery in four days, every image usable. We printed twelve. Twelve!', extra: 'Wedding' }
      ],
      price: [
        { icon: '👤', title: 'Portrait Session', text: '£220', extra: '60 min, edited gallery, full rights', tag: '' },
        { icon: '💍', title: 'Wedding Day', text: 'from £1,200', extra: 'Full day, second shooter option', tag: 'Popular' },
        { icon: '📦', title: 'Product Shoot', text: 'from £350', extra: 'Half day, styling + retouching', tag: '' }
      ],
      cta: { title: 'Let’s make images that work', text: 'Book a free pre-call — we will talk about what you need and how we shoot it.' },
      gal: ['Portrait in window light', 'Product hero shot', 'Wedding candids', 'The studio setup', 'Retouching pass', 'Behind the camera']
    },
    {
      id: 'detailing', name: 'Car Detailing Studio', type: 'auto',
      k: ['car detailing', 'car detailer', 'detailing studio', 'paint correction', 'ceramic coating', 'valeting', 'mobile detailing', 'car valet'],
      focus: 'car detailing',
      scenes: { hero: 'car being detailed polishing', about: 'detailing studio bay', gallery: 'detailed cars' },
      t: [
        "{brand} — paint correction, ceramic coating and interiors that look factory-new.",
        "Your car deserves better than a hand wash. {brand} does detailing properly.",
        "Machine polishing, paint-depth meters and towels that never touch the ground — {brand}."
      ],
      about: "{brand} is a proper detailing studio — not a valet bay with a jet wash. Every car is hand-washed with the two-bucket method, decontaminated, machine-polished by a certified detailer, and finished with a coating we actually stand behind. We photograph the paintwork before and after with paint-depth readings, because “perfect” should be measurable. Interiors get steam, not a spritz of sickly air freshener.",
      aboutTitle: 'Measured, not just shiny',
      feat: [
        { icon: '🧽', title: 'Two-Bucket Washing', text: 'Contactless pre-wash and proper technique — no swirls from dirty mitts.' },
        { icon: '🔬', title: 'Paint-Depth Meter', text: 'Clearcoat readings before correction — we measure, then improve.' },
        { icon: '🛡️', title: 'Ceramic Coatings', text: 'Multi-year protection from certified installers, with a written warranty.' },
        { icon: '🚗', title: 'Collection & Return', text: 'Booked cars are collected and returned — you never lose a day.' }
      ],
      stats: [
        { title: 'Cars detailed', text: '850+' }, { title: 'Certified detailers', text: '4' },
        { title: 'Coating warranty', text: '5y' }, { title: 'Client rating', text: '4.9★' }
      ],
      faqs: [
        { title: 'How long does a detail take?', text: 'Enhancement details 4–6 hours; full paint correction 2–3 days. We keep your car, not your time.' },
        { title: 'Is ceramic coating worth it?', text: 'For cars kept more than a year — yes. Easier washes, deeper gloss and genuine scratch resistance. We will be honest if your car does not need it.' },
        { title: 'Do you do interiors?', text: 'Steam, extraction and leather care — including pet hair removal, which we have made a sport of.' },
        { title: 'Can you fix swirl marks?', text: 'Swirls are our bread and butter — machine correction removes them rather than hiding them under wax.' }
      ],
      testis: [
        { title: 'Ryan Foster', text: 'The paint-depth readings before and after sold me. Proper, measurable work.', extra: 'Paint correction' },
        { title: 'Grace Liu', text: 'Ceramic coated my new SUV — nine months on it still beads like day one.', extra: 'Coating client' },
        { title: 'Martin Blake', text: 'Collected my car, returned it three days later looking better than showroom. Unreal.', extra: 'Full detail' }
      ],
      price: [
        { icon: '✨', title: 'Enhancement', text: '£180', extra: 'Wash, decontam, light polish, wax', tag: '' },
        { icon: '🔬', title: 'Paint Correction', text: 'from £450', extra: 'Measured, multi-stage machine polish', tag: 'Popular' },
        { icon: '🛡️', title: 'Ceramic Coating', text: 'from £650', extra: '5-year coating, written warranty', tag: '' }
      ],
      cta: { title: 'Book your paintwork an MOT', text: 'Get a free assessment — paint readings, honest advice, no hard sell.' },
      gal: ['Two-bucket wash', 'Machine polishing', 'Paint-depth reading', 'Ceramic application', 'Interior steam', 'The after shot']
    },
    {
      id: 'dog', name: 'Dog Grooming Studio', type: 'generic',
      k: ['dog grooming', 'dog groomer', 'dog grooming studio', 'pet grooming', 'dog wash', 'grooming salon', 'pet groomer'],
      focus: 'dog grooming',
      scenes: { hero: 'dog being groomed professionally', about: 'dog groomer at work salon', gallery: 'happy groomed dogs' },
      t: [
        "{brand} — calm handling, breed-correct cuts and a treat jar your dog will brag about.",
        "Grooming your dog should not feel like a hostage negotiation. {brand} makes it a spa day.",
        "From puppy's first groom to senior gentle care — {brand} dog grooming."
      ],
      about: "{brand} was started by a groomer who was tired of seeing dogs cowered in salon corners. We groom one dog at a time — never kennel queues, never shouting — with force-free handling, breed-correct styling and a low-stress bath room with rubber matting and warm water. Senior dogs and anxious dogs are our speciality, and a full groom includes a health-check style once-over of ears, teeth, skin and nails that owners tell us is worth the appointment alone.",
      aboutTitle: 'One dog at a time',
      feat: [
        { icon: '🐕', title: 'One-to-One Sessions', text: 'Never kennel queues — your dog has the groomer to themselves.' },
        { icon: '🤲', title: 'Force-Free Handling', text: 'Low-stress techniques, patience and treats — no shouting, ever.' },
        { icon: '✂️', title: 'Breed-Correct Cuts', text: 'Trained across every coat type, from poodle clips to double-coat desheds.' },
        { icon: '🩺', title: 'Health Over-Once', text: 'Ears, teeth, skin, nails and lumps checked at every groom — worth the trip alone.' }
      ],
      stats: [
        { title: 'Dogs groomed', text: '4,000+' }, { title: 'Grooming bays', text: '3' },
        { title: 'Owner rating', text: '4.9★' }, { title: 'Sessions per dog', text: '1 dog at a time' }
      ],
      faqs: [
        { title: 'How often should my dog be groomed?', text: 'Every 6–8 weeks for most coats. Double-coated breeds need a proper deshed on schedule — we will remind you.' },
        { title: 'My dog is anxious — can you help?', text: 'Anxious and senior dogs are our speciality. Book a half-session and we will go entirely at your dog’s pace.' },
        { title: 'Do you shave double-coated breeds?', text: 'No — shaving ruins their coat. We deshed properly instead, and we will tell you why when you book.' },
        { title: 'What should I do before the appointment?', text: 'Walk your dog first, skip breakfast if it is a nervous eater, and bring vaccination records for the first visit.' }
      ],
      testis: [
        { title: 'Lisa Harper', text: 'My rescue dog used to shake at the groomer’s. Here she trots in happily — that is everything.', extra: 'Anxious dog owner' },
        { title: 'James Porter', text: 'The coat health check caught a lump my vet visit had missed. Groomer of the year, honestly.', extra: 'Regular client' },
        { title: 'Meera Shah', text: 'First puppy groom — they sent photos and he looked thrilled. The treat jar works.', extra: 'Puppy parent' }
      ],
      price: [
        { icon: '🐩', title: 'Full Groom', text: '£45–70', extra: 'Bath, cut, nails, ears — by breed', tag: '' },
        { icon: '🐕', title: 'Bath & Tidy', text: '£30–45', extra: 'Bath, dry, brush, nails', tag: 'Popular' },
        { icon: '🐾', title: 'Puppy’s First Groom', text: '£25', extra: 'Gentle intro, no cut required', tag: '' }
      ],
      cta: { title: 'Come see the treat jar', text: 'Book a session — calm handling and a very shiny dog guaranteed.' },
      gal: ['Poodle clip in progress', 'Deshed satisfaction', 'Puppy first groom', 'Senior gentle care', 'The treat jar', 'After-shot smile'],
      extraSections: ['gallery']
    }
  ].concat((typeof AiNichesExtra !== 'undefined' && Array.isArray(AiNichesExtra))
    ? AiNichesExtra
    : (typeof require === 'function' ? (function () {
        try { return require('../data/ai-niches-extra.js'); } catch (e) { return []; }
      })() : []));

  function briefLib() {
    if (typeof AiBrief !== 'undefined') return AiBrief;
    try { if (typeof require === 'function') return require('../data/ai-brief.js'); } catch (e) { /* classic script */ }
    return null;
  }
  function followLib() {
    if (typeof AiFollowup !== 'undefined') return AiFollowup;
    try { if (typeof require === 'function') return require('../data/ai-followup.js'); } catch (e) { /* classic script */ }
    return null;
  }
  function fingerprintLib() {
    if (typeof AiFingerprint !== 'undefined') return AiFingerprint;
    try { if (typeof require === 'function') return require('../data/ai-fingerprint.js'); } catch (e) { /* classic script */ }
    return null;
  }
  function photoLib() {
    if (typeof AiPhotos !== 'undefined') return AiPhotos;
    try { if (typeof require === 'function') return require('../data/ai-photos.js'); } catch (e) { /* classic script */ }
    return null;
  }
  function composeLib() {
    if (typeof AiCompose !== 'undefined') return AiCompose;
    try { if (typeof require === 'function') return require('../data/ai-compose.js'); } catch (e) { /* classic script */ }
    return null;
  }
  function aaPaletteIds(ids) {
    const list = Array.isArray(ids) ? ids : [];
    const ok = list.filter((pid) => {
      const pal = (DB.palettes || []).find((p) => p.id === pid);
      if (!pal) return false;
      const ch = DB.paletteChecks(pal);
      return ch.length > 0 && ch.every((c) => c.ratio >= 4.5);
    });
    if (ok.length) return ok;
    return (DB.palettes || []).filter((p) => {
      if (!p || String(p.id).indexOf('pack_') === 0) return false;
      const ch = DB.paletteChecks(p);
      return ch.length > 0 && ch.every((c) => c.ratio >= 4.5);
    }).map((p) => p.id);
  }
  function speak(text, voice) {
    const lib = briefLib();
    return lib ? lib.applyVoice(text, voice) : String(text || '');
  }
  function voiceFrom(brief, extra) {
    const lib = briefLib();
    const stock = ['seamless', 'unleash', 'elevate', 'next-gen', 'world-class', 'cutting-edge'];
    const extraBanned = ((extra && extra.banned) || []).concat(stock);
    if (!lib) return { tone: (brief && brief.voice) || 'warm', banned: extraBanned };
    return lib.normalizeVoice({ tone: brief && brief.voice, banned: extraBanned });
  }

  // ----- prompt → concrete subject + scene -----
  // Search every subject entry regardless of the detected industry (a prompt
  // can name the real product even when the wording is ambiguous, e.g.
  // “dog grooming studio”).
  function extractSubjectAll(prompt) {
    const p = ' ' + String(prompt || '').toLowerCase().replace(/[^a-z0-9&']+/g, ' ') + ' ';
    let hit = null, bestPos = Infinity, bestLen = 0;
    for (const s of SUBJECTS) {
      for (const k of s.k) {
        const i = p.indexOf(' ' + k + ' ');
        if (i !== -1 && (i < bestPos || (i === bestPos && k.length > bestLen))) {
          hit = s; bestPos = i; bestLen = k.length;
        }
      }
    }
    return hit ? { type: hit.type, focus: hit.focus, scenes: hit.scenes } : null;
  }
  // Type-scoped version (falls back to the industry scene + focus).
  function extractSubject(prompt, typeId) {
    const p = ' ' + String(prompt || '').toLowerCase().replace(/[^a-z0-9&']+/g, ' ') + ' ';
    let hit = null, bestPos = Infinity;
    for (const s of SUBJECTS) {
      if (typeId !== 'generic' && s.type !== typeId) continue;
      for (const k of s.k) {
        const i = p.indexOf(' ' + k + ' ');
        if (i !== -1 && i < bestPos) { hit = s; bestPos = i; }
      }
    }
    if (hit) return { type: hit.type, focus: hit.focus, scenes: hit.scenes, matched: true };
    // no specific subject — fall back to the industry scene + focus
    return { type: typeId, k: [], focus: TYPE_FOCUS[typeId] || TYPE_FOCUS.generic, scenes: TYPE_SCENES[typeId] || TYPE_SCENES.generic, matched: false };
  }

  // ----- deep niche packs: matcher + overlay -----
  // Pick the deepest sub-niche whose keyword appears earliest (longest key wins
  // ties), scanning the prompt AND a studied website's text.
  function matchNiche(text) {
    const p = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9&']+/g, ' ') + ' ';
    let hit = null, bestPos = Infinity, bestLen = 0;
    for (const n of NICHES) {
      for (const k of n.k) {
        const i = p.indexOf(' ' + k + ' ');
        if (i !== -1 && (i < bestPos || (i === bestPos && k.length > bestLen))) {
          hit = n; bestPos = i; bestLen = k.length;
        }
      }
    }
    return hit;
  }
  // Merge a niche pack over an industry type so copyBank can consume either.
  // Only fields the pack defines override the base type — a niche is a layer,
  // not a full replacement, so nothing ever comes out thin.
  function effectiveType(type, niche) {
    if (!niche) return type;
    const t = {
      ...type,
      taglines: (niche.t && niche.t.length ? niche.t : type.taglines),
      about: niche.about || type.about,
      aboutTitle: niche.aboutTitle || type.aboutTitle || 'About us',
      features: (niche.feat && niche.feat.length ? niche.feat : type.features),
      stats: (niche.stats && niche.stats.length ? niche.stats : type.stats),
      faqs: (niche.faqs && niche.faqs.length ? niche.faqs : type.faqs),
      testis: (niche.testis && niche.testis.length ? niche.testis : type.testis),
      pricing: (niche.price && niche.price.length ? niche.price : type.pricing),
      cta: niche.cta || type.cta,
      gallery: (niche.gal && niche.gal.length ? niche.gal : type.gallery)
    };
    return t;
  }

  // Clean, natural {focus} phrase for copy banks (no adjectives / noise words).
  function focusPhrase(prompt) {
    const raw = String(prompt || '');
    const all = extractSubjectAll(raw);
    if (all) return all.focus;
    const type = detectType(raw);
    return extractSubject(raw, type.id).focus;
  }

  // ----- taste: what the asker wants it to FEEL like -----
  const TASTE = {
    minimal:  { keys: ['minimal', 'clean', 'simple', 'austere', 'quiet', 'airy', 'scandinavian'], dark: 0, serif: 1, radius: 'tight' },
    editorial: { keys: ['editorial', 'magazine', 'fashion', 'sophisticated', 'elegant', 'luxe', 'luxury', 'refined', 'premium', 'high-end', 'exclusive', 'expensive'], dark: 0, serif: 1, radius: 'tight' },
    premium:  { keys: ['premium', 'luxury', 'upscale', 'exclusive', 'high-end'], dark: 1, serif: 1, radius: 'med' },
    playful:  { keys: ['playful', 'fun', 'colorful', 'colourful', 'quirky', 'cheerful', 'bright', 'youthful', 'cute', 'friendly', 'whimsical'], dark: 0, serif: 0, radius: 'round' },
    bold:     { keys: ['bold', 'loud', 'punchy', 'edgy', 'gritty', 'urban', 'raw', 'experimental', 'controversial'], dark: 1, serif: 0, radius: 'tight' },
    techy:    { keys: ['sleek', 'tech', 'startup', 'saas', 'app', 'software', 'innovative', 'futuristic', 'cutting-edge'], dark: 1, serif: 0, radius: 'med' },
    warm:     { keys: ['warm', 'cozy', 'rustic', 'artisan', 'artisanal', 'handmade', 'organic', 'natural', 'wholesome', 'homely'], dark: 0, serif: 1, radius: 'round' },
    vibrant:  { keys: ['vibrant', 'energetic', 'dynamic', 'high-energy', 'electric'], dark: 0, serif: 0, radius: 'round' }
  };
  function detectTaste(prompt) {
    const p = ' ' + String(prompt || '').toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
    let best = null, bestScore = 0, bestPos = Infinity;
    for (const [id, t] of Object.entries(TASTE)) {
      let score = 0, pos = Infinity;
      for (const k of t.keys) {
        const i = p.indexOf(' ' + k + ' ');
        if (i !== -1) { score++; pos = Math.min(pos, i); }
      }
      if (score > bestScore || (score === bestScore && score > 0 && pos < bestPos)) { best = id; bestScore = score; bestPos = pos; }
    }
    return best; // null = no strong taste signal
  }

  // ----- design DNA: coordinated palettes / typography / rhythm -----
  // Each look pulls palette IDs, a heading style and a body style together so
  // two sites for the same brief still come out visually distinct.
  const LOOK_PALETTES = {
    light:    ['paper', 'sage', 'mulberry', 'lagoon', 'aurora', 'ocean', 'emerald'],
    warm:     ['paper', 'sage', 'sunset', 'terracotta', 'roast', 'blush', 'candy'],
    bright:   ['candy', 'lagoon', 'aurora', 'cherry', 'sunset', 'emerald'],
    dark:     ['ink', 'cobalt', 'grape', 'pine', 'midnight', 'noir', 'roast'],
    editorial: ['paper', 'stone', 'ink', 'mulberry', 'grape', 'noir'],
    classic:  ['midnight', 'ocean', 'noir', 'candy', 'sunset', 'emerald', 'aurora']
  };
  // serif/sans/mono heading pools (free first, pro appended for paid tiers)
  const HEAD_SERIF = ['playfair', 'dmserif', 'newsreader', 'lora', 'sourceserif', 'fraunces', 'bodoni', 'cormorant'];
  const HEAD_SANS = ['spacegrotesk', 'sora', 'oswald', 'montserrat', 'poppins', 'bebas', 'syne', 'unbounded', 'anton', 'archivoblack', 'righteous'];
  const HEAD_MONO = ['jetbrains', 'spacemono', 'firacode'];
  const BODY_SANS = ['inter', 'poppins', 'spacegrotesk', 'sora', 'outfit', 'manrope', 'montserrat', 'plusjakarta', 'dmsans', 'figtree', 'worksans', 'lexend', 'raleway'];
  const BODY_SERIF = ['lora', 'sourceserif', 'merriweather', 'newsreader', 'playfair', 'dmserif', 'fraunces', 'cormorant'];

  function freePool(pool, tier) {
    return tier === 'pro' ? pool.slice() : pool.filter((f) => !PRO_FONTS.has(f));
  }
  // pick a font from pool, avoiding a specific other font when possible
  function pickFontFrom(pool, seed, avoid) {
    const list = pool.length ? pool : ['inter'];
    let f = list[Math.abs(seed) % list.length];
    if (avoid && list.length > 1 && f === avoid) f = list[(Math.abs(seed) + 1) % list.length];
    return f;
  }

  // Choose the look: taste drives it, otherwise the business type picks a
  // family of looks so variety comes from jitter, not luck.
  function lookFor(typeId, taste, seed) {
    const j = Math.abs(seed) % 10;
    const map = {
      tech:     ['dark', 'techy-', 'minimal-', 'editorial-'],
      creative: ['editorial-', 'light-', 'noir-', 'playful-'],
      food:     ['warm-', 'light-', 'playful-', 'editorial-'],
      retail:   ['light-', 'playful-', 'warm-', 'editorial-'],
      travel:   ['editorial-', 'light-', 'warm-', 'bright-'],
      fitness:  ['bold-', 'bright-', 'dark-'],
      beauty:   ['editorial-', 'light-', 'warm-'],
      edu:      ['light-', 'bright-', 'editorial-'],
      home:     ['warm-', 'light-', 'bold-'],
      events:   ['editorial-', 'light-', 'bright-'],
      auto:     ['bold-', 'dark-', 'warm-'],
      music:    ['dark-', 'bold-', 'noir-'],
      nonprofit: ['light-', 'warm-', 'editorial-'],
      generic:  ['light-', 'editorial-', 'warm-', 'dark-']
    };
    const tray = map[typeId] || map.generic;
    let pick = tray[j % tray.length];
    if (taste) {
      const t = TASTE[taste];
      const byTaste = { dark: 'dark-', light: 'light-', serif: 'editorial-', warm: 'warm-', bright: 'bright-' };
      if (t.dark && j % 3 !== 2) pick = byTaste.dark;
      else if (t.serif && j % 2 === 0) pick = byTaste.serif;
      else if (!t.serif && t.radius === 'round' && !t.dark) pick = byTaste.bright;
      else if (t.serif && !t.dark && j % 3 !== 1) pick = byTaste.light;
    }
    return pick.replace(/-$/, ''); // 'noir', 'bold', 'playful', 'techy', 'minimal' etc.
  }

  const LOOK_STYLE = {
    editorial: { radius: 6,   spacing: 112, pal: 'editorial', head: 'serif', body: 'sans' },
    light:     { radius: 22,  spacing: 104, pal: 'light', head: 'sans', body: 'sans' },
    warm:      { radius: 26,  spacing: 100, pal: 'warm', head: 'serif', body: 'sans' },
    bright:    { radius: 22,  spacing: 100, pal: 'bright', head: 'sans', body: 'sans' },
    dark:      { radius: 18,  spacing: 112, pal: 'dark', head: 'sans', body: 'sans' },
    bold:      { radius: 4,   spacing: 96,  pal: 'bright', head: 'display', body: 'sans' },
    noir:      { radius: 8,   spacing: 108, pal: 'dark', head: 'serif', body: 'sans' },
    playful:   { radius: 30,  spacing: 92,  pal: 'bright', head: 'display', body: 'sans' },
    techy:     { radius: 14,  spacing: 108, pal: 'dark', head: 'mono', body: 'sans' },
    minimal:   { radius: 10,  spacing: 132, pal: 'light', head: 'sans', body: 'sans' }
  };

  // returns { look, palette, font, fontDisplay, radius, spacing }
  function pickDesignDNA(type, prompt, opts, seed) {
    const tier = opts.tier === 'free' ? 'free' : 'pro';
    const taste = detectTaste(prompt);
    const requestedLook = opts && opts.look && LOOK_STYLE[opts.look] ? opts.look : '';
    const look = requestedLook || lookFor(type.id, taste, seed);
    const ls = LOOK_STYLE[look] || LOOK_STYLE.light;
    const freeOK = (f) => tier === 'pro' || !PRO_FONTS.has(f);

    // palette: prefer the look's family, keep a classic type palette ~35% of the time
    let palette;
    const fam = aaPaletteIds((LOOK_PALETTES[ls.pal] || LOOK_PALETTES.light).filter((pid) => DB.getPalette(pid)));
    if (Math.abs(seed) % 10 < 4 && type.palettes && type.palettes.length) {
      const legacy = aaPaletteIds(type.palettes.filter((pid) => DB.getPalette(pid)));
      palette = pick(legacy.length ? legacy : fam, seed + 3);
    } else {
      palette = pick(fam.length ? fam : ['paper'], seed);
    }

    // heading + body pairing
    let bodyPool = ls.body === 'serif' ? BODY_SERIF : BODY_SANS;
    let headPool = ls.head === 'serif' ? HEAD_SERIF : ls.head === 'mono' ? HEAD_MONO : ls.head === 'display' ? HEAD_SANS : null;
    const bodyPoolFree = bodyPool.filter(freeOK);
    const bodyFont = pickFontFrom(bodyPoolFree.length ? bodyPoolFree : ['inter'], seed >> 1);
    let headFont = bodyFont;
    if (headPool && Math.abs(seed) % 10 < 8) {
      const headPoolFree = headPool.filter((f) => freeOK(f) && f !== bodyFont);
      if (headPoolFree.length) {
        // editorial serif + sans is the classic premium pairing
        headFont = pickFontFrom(headPoolFree, seed + 5, bodyFont);
      }
    }
    // guarantee a real distinction when the look asks for a display head
    if (ls.head === 'serif' && headFont === bodyFont && Math.abs(seed) % 2 === 0 && bodyPool === BODY_SANS) {
      const serifFree = HEAD_SERIF.filter((f) => freeOK(f));
      if (serifFree.length) headFont = pickFontFrom(serifFree, seed + 7, bodyFont);
    }
    if (ls.head === 'mono' && headFont === bodyFont) {
      const monoFree = HEAD_MONO.filter((f) => freeOK(f));
      if (monoFree.length) headFont = pickFontFrom(monoFree, seed + 9, bodyFont);
    }

    return { look, palette, font: bodyFont, fontDisplay: headFont !== bodyFont ? headFont : '', radius: ls.radius, spacing: ls.spacing };
  }
  // platform-aware shortcut label (⌘ on macOS, Ctrl elsewhere)
  const KBD = (typeof window !== 'undefined' && window.pallettai && window.pallettai.platform === 'darwin') ? '⌘' : 'Ctrl+';

  // ---------- business type knowledge base ----------
  const TYPES = [
    {
      id: 'tech', keys: ['tech', 'saas', 'software', 'app', 'startup', 'ai', 'cloud', 'digital', 'cyber', 'dev', 'platform', 'fintech', 'developer', 'b2b', 'api'],
      palettes: ['midnight', 'ocean', 'noir'], fonts: ['spacegrotesk', 'sora', 'inter'],
      names: ['Nexa', 'Vela', 'Kestrel', 'Atlas', 'Quantix'], suffixes: ['Labs', 'Systems', 'HQ', 'Digital'],
      taglines: [
        'The {focus} platform modern teams trust — designed, built and shipped by {brand}.',
        '{brand} turns ambitious {focus} ideas into products that ship fast and scale further.'
      ],
      about: '{brand} started with a simple belief: {focus} shouldn\'t mean compromise. Today our team of engineers, designers and strategists partners with companies of every size to build products people genuinely love to use — measured by speed, trust and results.',
      features: [
        { icon: '⚡', title: 'Lightning Fast', text: 'Everything loads instantly, on every device, with buttery-smooth interactions.' },
        { icon: '🔒', title: 'Secure by Default', text: 'Modern encryption and privacy controls are baked in from day one.' },
        { icon: '🧩', title: 'Plays Well Together', text: 'Connects with the tools your team already uses, in minutes.' },
        { icon: '📈', title: 'Built to Grow', text: 'Analytics, automations and scale-ready infrastructure included.' }
      ],
      stats: [
        { title: 'Active users', text: '12K+' }, { title: 'Uptime', text: '99.99%' },
        { title: 'Countries served', text: '40+' }, { title: 'Avg. response', text: '0.4s' }
      ],
      testis: [
        { title: 'Maya Chen', text: 'We doubled conversion in six weeks. The team felt like an extension of ours.', extra: 'CEO, Nortide' },
        { title: 'Leo Fischer', text: 'Fast, reliable and genuinely delightful. Our customers noticed on day one.', extra: 'Founder, Draftline' },
        { title: 'Ava Okafor', text: 'Finally a partner that ships what they promise — on time, every time.', extra: 'CTO, Studio Kala' }
      ],
      faqs: [
        { title: 'How fast can we launch?', text: 'Most clients are live within two weeks. Larger builds typically take four to six.' },
        { title: 'Is our data secure?', text: 'All data is encrypted in transit and at rest, with granular access controls.' },
        { title: 'Do you support custom integrations?', text: 'Yes — our team builds and maintains integrations with any tool you rely on.' },
        { title: 'What happens after launch?', text: 'You get ongoing support, monitoring and a roadmap of improvements.' }
      ],
      pricing: [
        { icon: '🌱', title: 'Starter', text: '£9', extra: '1 project · 5k visitors/mo · Email support', tag: '' },
        { icon: '⚡', title: 'Pro', text: '£29', extra: 'Unlimited projects · Priority support', tag: 'Popular' },
        { icon: '🏢', title: 'Scale', text: '£79', extra: 'Dedicated manager · SLA · Custom builds', tag: '' }
      ],
      cta: { title: 'Ready to build something great?', text: 'Book a free strategy call — no pressure, no jargon.' },
      aboutTitle: 'Our story', gallery: null,
      sections: ['hero', 'about', 'features', 'stats', 'pricing', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'creative', keys: ['agency', 'design', 'studio', 'creative', 'brand', 'portfolio', 'photography', 'art', 'media', 'marketing', 'illustration', 'video', 'creative agency', 'design studio', 'photo studio', 'branding', 'graphic design'],
      palettes: ['noir', 'aurora', 'candy'], fonts: ['playfair', 'dmserif', 'sora'],
      names: ['Lumina', 'Meridian', 'Aster', 'Fieldnote', 'Halcyon'], suffixes: ['Studio', '& Co', 'Collective', 'Works'],
      taglines: [
        '{brand} is a {focus} studio crafting work that moves brands and the people who love them.',
        'We design {focus} with intent — every pixel earning its place.'
      ],
      about: 'We\'re a tight-knit team of designers, writers and makers. {brand} was founded on the idea that great work comes from obsession with detail and honest collaboration — and it shows in every project we ship.',
      features: [
        { icon: '🎨', title: 'Brand Identity', text: 'Logos, voice and systems that make you unmistakable.' },
        { icon: '🌐', title: 'Web & Product', text: 'Sites and apps that feel as good as they look.' },
        { icon: '📸', title: 'Photography', text: 'Original imagery that tells your story, not stock.' },
        { icon: '🎬', title: 'Motion', text: 'Animation that guides the eye and earns attention.' }
      ],
      stats: [
        { title: 'Projects shipped', text: '300+' }, { title: 'Design awards', text: '18' },
        { title: 'Happy clients', text: '95' }, { title: 'Years of craft', text: '8' }
      ],
      testis: [
        { title: 'Sofia Reyes', text: 'They gave our brand a voice clients instantly remember.', extra: 'CMO, Solace' },
        { title: 'Daniel Kim', text: 'The work feels alive without ever being distracting. Rare balance.', extra: 'Director, Kite Studio' },
        { title: 'Hana Yoshida', text: 'Our new identity won two awards in its first month.', extra: 'Founder, Terra' }
      ],
      faqs: [
        { title: 'How do projects start?', text: 'A free discovery call, a clear proposal, and a kickoff workshop to align on goals.' },
        { title: 'What does a typical timeline look like?', text: 'Brand projects run 4–8 weeks; full websites 6–12 weeks depending on scope.' },
        { title: 'Do you work with startups?', text: 'Yes — we love early-stage teams and offer flexible, staged engagements.' }
      ],
      pricing: [
        { icon: '🎯', title: 'Starter Brand', text: '£2.5k', extra: 'Logo, palette, typography, 5 pages', tag: '' },
        { icon: '🚀', title: 'Full Identity', text: '£6k', extra: 'Everything + voice, motion, guidelines', tag: 'Popular' },
        { icon: '🤝', title: 'Retainer', text: '£3k/mo', extra: 'Ongoing design partner, unlimited requests', tag: '' }
      ],
      cta: { title: 'Let\'s make something people remember', text: 'Tell us about your project — we reply within 24 hours.' },
      aboutTitle: 'The studio', gallery: ['Brand identity for Solace', 'Editorial — Northwind', 'Website — Kite Studio', 'Packaging — Terra', 'Campaign — Wildfire', 'App design — Drift'],
      sections: ['hero', 'about', 'gallery', 'features', 'stats', 'testimonials', 'cta', 'contact']
    },
    {
      id: 'food', keys: ['food', 'restaurant', 'cafe', 'café', 'bakery', 'coffee', 'pizza', 'bistro', 'kitchen', 'dining', 'bar', 'grill', 'patisserie', 'food truck', 'steakhouse', 'burger', 'sushi', 'ramen', 'brunch', 'wine bar', 'taco', 'dessert', 'ice cream', 'brewery', 'pub'],
      palettes: ['sunset', 'cherry', 'emerald'], fonts: ['dmserif', 'playfair', 'pacifico'],
      names: ['Maison', 'Tavola', 'Bella', 'Rustica', 'Amber'], suffixes: ['Kitchen', 'Café', 'Bakery', 'Table'],
      taglines: [
        'Welcome to {brand} — honest {focus}, made fresh every day with love.',
        'At {brand} we believe great {focus} starts with great ingredients and even better company.'
      ],
      about: 'Every dish at {brand} begins at the market before sunrise. Our kitchen turns seasonal ingredients into plates worth lingering over — whether it\'s your first visit or your hundredth, you\'ll always be treated like family.',
      features: [
        { icon: '🍽️', title: 'Chef\'s Menu', text: 'A seasonal tasting menu that changes with the market.' },
        { icon: '🚚', title: 'Fresh Daily', text: 'Produce delivered every morning, never frozen, never tired.' },
        { icon: '🍷', title: 'Curated Pairings', text: 'Local wines and craft pours matched to every course.' },
        { icon: '🥡', title: 'Takeaway & Delivery', text: 'The same kitchen, packed beautifully for home.' }
      ],
      stats: [
        { title: 'Dishes on rotation', text: '40+' }, { title: 'Guest rating', text: '4.9★' },
        { title: 'Years cooking', text: '12' }, { title: 'Guests served', text: '250K' }
      ],
      testis: [
        { title: 'Emma Larsen', text: 'The tasting menu was the highlight of our whole trip. Unforgettable.', extra: 'Food writer' },
        { title: 'Tom Bisset', text: 'I\'ve eaten here 30 times and it still surprises me. Every. Single. Time.', extra: 'Regular guest' },
        { title: 'Priya Nair', text: 'Service that makes you feel like the only table in the room.', extra: 'Local foodie' }
      ],
      faqs: [
        { title: 'Do you take reservations?', text: 'Yes — book online up to 30 days ahead. Walk-ins are always welcome at the bar.' },
        { title: 'Can you accommodate dietary needs?', text: 'Absolutely. Tell us when you book and we\'ll tailor the menu.' },
        { title: 'Is there parking?', text: 'Free parking is available behind the venue, plus bike racks out front.' }
      ],
      pricing: [
        { icon: '🥐', title: 'À La Carte', text: '££', extra: 'Signature plates, fresh daily', tag: '' },
        { icon: '🍷', title: 'Chef\'s Table', text: '£££', extra: 'Tasting menu + pairings', tag: 'Popular' },
        { icon: '🎉', title: 'Private Events', text: '££££', extra: 'Full buyouts & celebrations', tag: '' }
      ],
      cta: { title: 'Your table is waiting', text: 'Book now — we can\'t wait to feed you.' },
      aboutTitle: 'Our kitchen', gallery: ['Chef\'s daily special', 'The tasting menu', 'Bakery at dawn', 'Patio evenings', 'Fresh from the market', 'Pairings flight'],
      sections: ['hero', 'about', 'gallery', 'features', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'retail', keys: ['shop', 'store', 'retail', 'boutique', 'ecommerce', 'e-commerce', 'online store', 'fashion', 'jewelry', 'jewellery', 'gifts', 'gift shop', 'florist', 'flower shop', 'market', 'clothing'],
      palettes: ['candy', 'emerald', 'ocean'], fonts: ['poppins', 'outfit', 'montserrat'],
      names: ['Velvet', 'Harvest', 'Nomad', 'Bloom', 'Cinder'], suffixes: ['& Co', 'Market', 'Goods', 'Supply'],
      taglines: [
        'Handpicked {focus} for people who notice the details — brought to you by {brand}.',
        'Shop {focus} with soul at {brand}. Curated, quality, delivered with care.'
      ],
      about: '{brand} began at a weekend market stall with a single crate of goods we believed in. Today we\'re a curated {focus} destination — still picking every product by hand, still treating every order like a gift.',
      features: [
        { icon: '🛍️', title: 'Curated Selection', text: 'Every item hand-picked — if it\'s here, we love it.' },
        { icon: '🚚', title: 'Fast Delivery', text: 'Order today, enjoy tomorrow. Worldwide, tracked.' },
        { icon: '💝', title: 'Gift-Ready', text: 'Complimentary wrapping and handwritten notes.' },
        { icon: '🔄', title: 'Easy Returns', text: '30-day returns, no questions asked.' }
      ],
      stats: [
        { title: 'Products curated', text: '500+' }, { title: 'Customer rating', text: '4.8★' },
        { title: 'Orders shipped', text: '40K' }, { title: 'Members', text: '9K' }
      ],
      testis: [
        { title: 'Nora Hughes', text: 'The packaging alone made me a customer for life.', extra: 'Verified buyer' },
        { title: 'Sam Oduya', text: 'Quality is unreal for the price. My third order already.', extra: 'Verified buyer' },
        { title: 'Lena Kovac', text: 'Sent as a gift — recipient thought I spent three times as much.', extra: 'Verified buyer' }
      ],
      faqs: [
        { title: 'How fast is delivery?', text: 'Local orders arrive in 1–2 days; international in 3–7 business days.' },
        { title: 'Can I return an item?', text: 'Yes — 30 days, full refund, prepaid label included.' },
        { title: 'Do you offer gift wrapping?', text: 'Every order can be wrapped and hand-signed for free.' }
      ],
      pricing: [
        { icon: '🧺', title: 'Essentials', text: '£19', extra: 'Best of the basics, monthly', tag: '' },
        { icon: '✨', title: 'Signature', text: '£39', extra: 'Curated picks + member perks', tag: 'Popular' },
        { icon: '💎', title: 'Collector', text: '£89', extra: 'Limited drops, first access', tag: '' }
      ],
      cta: { title: 'Find something you\'ll love', text: 'New arrivals land every Friday — don\'t miss the drop.' },
      aboutTitle: 'Our story', gallery: ['The latest drop', 'Behind the counter', 'Fresh arrivals', 'Gift wrapping', 'The workshop', 'Member evenings'],
      sections: ['hero', 'about', 'gallery', 'features', 'pricing', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'travel', keys: ['travel', 'tour', 'hotel', 'resort', 'adventure', 'trip', 'vacation', 'hostel', 'wander', 'expedition', 'travel agency', 'tour operator', 'guesthouse', 'getaway'],
      palettes: ['sunset', 'ocean', 'aurora'], fonts: ['dmserif', 'playfair', 'outfit'],
      names: ['Voyage', 'Driftwood', 'Meridian', 'Northstar', 'Wander'], suffixes: ['Tours', 'Travel', '& Co', 'Expeditions'],
      taglines: [
        'Step off the beaten path with {brand} — crafted {focus} for curious travellers.',
        '{brand} designs {focus} you\'ll still be telling stories about in ten years.'
      ],
      about: '{brand} was born from a simple frustration: travel felt like a checklist. We build trips the way locals would — hidden trails, family-run tables, mornings with no itinerary. Small groups, big memories, zero guesswork.',
      features: [
        { icon: '🗺️', title: 'Handcrafted Routes', text: 'Every itinerary designed by people who\'ve walked it.' },
        { icon: '🏨', title: 'Handpicked Stays', text: 'Characterful places locals actually recommend.' },
        { icon: '🧭', title: 'Local Guides', text: 'Storytellers, not script-readers.' },
        { icon: '🛡️', title: 'Flexible Booking', text: 'Free rescheduling up to 14 days before departure.' }
      ],
      stats: [
        { title: 'Trips led', text: '1,200+' }, { title: 'Destinations', text: '60' },
        { title: 'Happy travellers', text: '8K' }, { title: 'Trip rating', text: '4.9★' }
      ],
      testis: [
        { title: 'Jonas Weber', text: 'Every detail was handled. We just showed up and enjoyed.', extra: 'Traveller, 2025' },
        { title: 'Clara Mbeki', text: 'Our guide felt like an old friend showing us their hometown.', extra: 'Traveller, 2025' },
        { title: 'Arun Patel', text: 'Best trip of my life. Booked again for next spring.', extra: 'Traveller, 2024' }
      ],
      faqs: [
        { title: 'What is your cancellation policy?', text: 'Free cancellation up to 14 days before departure; full refund within 7.' },
        { title: 'Are trips suitable for families?', text: 'Absolutely — dedicated family routes with child-friendly guides.' },
        { title: 'Do you offer private tours?', text: 'Yes, for groups of any size. Contact us for a custom quote.' }
      ],
      pricing: [
        { icon: '🏕️', title: 'Day Escape', text: '£89', extra: 'Full-day guided adventure, lunch included', tag: '' },
        { icon: '🌄', title: 'Weekend', text: '£349', extra: '3 days, handpicked stays, small group', tag: 'Popular' },
        { icon: '🧭', title: 'Expedition', text: '£1.2k', extra: '8-day journey, fully private', tag: '' }
      ],
      cta: { title: 'The world is calling', text: 'Book your next adventure — limited spots per season.' },
      aboutTitle: 'Why travel with us', gallery: ['Coastal trails', 'Old town sunrise', 'Harbour evening', 'Mountain ridge', 'Market colors', 'Beach farewell'],
      sections: ['hero', 'about', 'gallery', 'features', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'fitness', keys: ['fitness', 'gym', 'yoga', 'wellness', 'health', 'training', 'pilates', 'sports', 'crossfit', 'workout', 'personal trainer', 'bootcamp', 'dance studio', 'boxing'],
      palettes: ['noir', 'emerald', 'ocean'], fonts: ['bebas', 'spacegrotesk', 'montserrat'],
      names: ['Forge', 'Kinetic', 'Vital', 'Ironline', 'Flow'], suffixes: ['Fitness', 'Lab', 'Club', 'Performance'],
      taglines: [
        'Train smarter, feel unstoppable — {brand} builds {focus} programs around you, not the other way around.',
        'At {brand}, {focus} is a habit we help you love. Come as you are.'
      ],
      about: '{brand} is more than a gym — it\'s a community of coaches and members who show up for each other. Science-backed programs, zero judgment, and results you can measure in how you feel, not just what the scale says.',
      features: [
        { icon: '💪', title: 'Personal Coaching', text: '1:1 programs tailored to your body and goals.' },
        { icon: '🧘', title: 'Group Classes', text: 'High-energy sessions for every level, every day.' },
        { icon: '📱', title: 'Track Everything', text: 'App-based workouts, progress and nutrition logging.' },
        { icon: '🥗', title: 'Nutrition Plans', text: 'Simple, sustainable eating plans that fit real life.' }
      ],
      stats: [
        { title: 'Active members', text: '850' }, { title: 'Classes / week', text: '40' },
        { title: 'Member rating', text: '4.9★' }, { title: 'Years coaching', text: '6' }
      ],
      testis: [
        { title: 'Marcus Bell', text: 'Down 14kg and stronger than I\'ve ever been. The coaches are magic.', extra: 'Member, 2 years' },
        { title: 'Iris Novak', text: 'First gym that ever felt like home. I actually look forward to it.', extra: 'Member, 1 year' },
        { title: 'Diego Ramos', text: 'The programming is next-level. My lifts keep climbing every month.', extra: 'Athlete' }
      ],
      faqs: [
        { title: 'I\'m a beginner — is this for me?', text: 'Yes. Every program scales to your level, and your first session is a free assessment.' },
        { title: 'What\'s the membership cost?', text: 'Day passes, monthly memberships and annual plans — no lock-in contracts.' },
        { title: 'Do you have personal trainers?', text: 'Yes, all certified, with experience across strength, mobility and rehab.' }
      ],
      pricing: [
        { icon: '🎟️', title: 'Day Pass', text: '£15', extra: 'Full access, one day', tag: '' },
        { icon: '🔥', title: 'Monthly', text: '£49', extra: 'Unlimited classes + app', tag: 'Popular' },
        { icon: '🏆', title: 'Coaching', text: '£129', extra: 'Personal coach + nutrition', tag: '' }
      ],
      cta: { title: 'Your first session is on us', text: 'Come try a class — no commitment, no pressure.' },
      aboutTitle: 'Train with us', gallery: null,
      sections: ['hero', 'about', 'features', 'stats', 'pricing', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'beauty', keys: ['beauty', 'salon', 'spa', 'barber', 'hair', 'nails', 'cosmetic', 'skincare', 'makeup', 'lash', 'hair salon', 'nail salon', 'beauty salon', 'barber shop', 'day spa', 'lash studio', 'tattoo'],
      palettes: ['cherry', 'candy', 'midnight'], fonts: ['playfair', 'poppins', 'pacifico'],
      names: ['Lumière', 'Velvet', 'Rosé', 'Glow', 'Mira'], suffixes: ['Beauty', 'Spa', 'Salon', 'Atelier'],
      taglines: [
        'You deserve a little ceremony. {brand} brings {focus} that\'s as calming as it is transformative.',
        'Step into {brand} — where {focus} becomes self-care and every visit leaves you glowing.'
      ],
      about: 'At {brand}, we treat beauty as wellness. Our stylists and therapists train continuously, we use organic, cruelty-free products, and every treatment starts with a consultation — because your ritual should be as unique as you are.',
      features: [
        { icon: '✨', title: 'Signature Treatments', text: 'Rituals designed to reset both skin and spirit.' },
        { icon: '💇', title: 'Expert Stylists', text: 'Continuously trained, wildly talented, endlessly kind.' },
        { icon: '🌿', title: 'Clean Products', text: 'Organic, cruelty-free and kind to sensitive skin.' },
        { icon: '📅', title: 'Easy Booking', text: 'Book in 30 seconds online, reschedule anytime.' }
      ],
      stats: [
        { title: 'Artists & therapists', text: '12' }, { title: '5★ reviews', text: '2.4K' },
        { title: 'Years of care', text: '9' }, { title: 'Client rating', text: '4.9★' }
      ],
      testis: [
        { title: 'Chloe Martin', text: 'The best haircut of my life, and the scalp massage alone was worth it.', extra: 'Client since 2021' },
        { title: 'Amara Diallo', text: 'My skin has never looked better. The facials are pure therapy.', extra: 'Spa member' },
        { title: 'Fatima Zahra', text: 'They listen. Truly listen. That\'s rarer than you\'d think.', extra: 'Regular client' }
      ],
      faqs: [
        { title: 'Do I need to book ahead?', text: 'We recommend it — weekends fill up fast. Walk-ins welcome on quiet days.' },
        { title: 'Are your products safe for sensitive skin?', text: 'Yes, our lines are hypoallergenic and dermatologist-approved.' },
        { title: 'What\'s your cancellation policy?', text: 'Free cancellation up to 4 hours before your appointment.' }
      ],
      pricing: [
        { icon: '💅', title: 'Express', text: '£35', extra: 'Wash, style & brow tidy', tag: '' },
        { icon: '✨', title: 'Signature', text: '£85', extra: 'Cut, colour & finish', tag: 'Popular' },
        { icon: '🌿', title: 'Spa Ritual', text: '£150', extra: 'Facial, massage & treatment', tag: '' }
      ],
      cta: { title: 'Book your moment of calm', text: 'Evenings and weekends available — your chair is waiting.' },
      aboutTitle: 'Our philosophy', gallery: ['The studio', 'Signature facial', 'Colour at work', 'Bridal glam', 'Spa retreat', 'Fresh set'],
      sections: ['hero', 'about', 'gallery', 'features', 'pricing', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'edu', keys: ['school', 'academy', 'course', 'tutor', 'learn', 'education', 'coach', 'workshop', 'classes', 'university', 'coding', 'music school', 'driving school', 'language school', 'bootcamp', 'tutoring'],
      palettes: ['ocean', 'aurora', 'emerald'], fonts: ['sora', 'outfit', 'inter'],
      names: ['Brightpath', 'Northgate', 'Skillforge', 'Alta', 'Summit'], suffixes: ['Academy', 'School', 'Institute', 'Lab'],
      taglines: [
        'Learn {focus} the way it should be taught — with experts, at your pace, at {brand}.',
        '{brand} turns curiosity into capability. Your {focus} journey starts here.'
      ],
      about: '{brand} exists because learning shouldn\'t feel like a chore. Our instructors are working professionals, our curriculum is updated monthly, and our students graduate with portfolios — not just certificates.',
      features: [
        { icon: '📚', title: 'Expert-Led Courses', text: 'Taught by practitioners who do this every day.' },
        { icon: '🎯', title: '1:1 Mentoring', text: 'Regular sessions with a dedicated mentor.' },
        { icon: '🏆', title: 'Real Certificates', text: 'Credentials employers actually recognise.' },
        { icon: '💻', title: 'Learn Anywhere', text: 'Live and self-paced tracks that fit your life.' }
      ],
      stats: [
        { title: 'Students taught', text: '3,400+' }, { title: 'Courses live', text: '60' },
        { title: 'Student rating', text: '4.8★' }, { title: 'Expert coaches', text: '25' }
      ],
      testis: [
        { title: 'Owen Pierce', text: 'Career changed in six months. The mentors refuse to let you fail.', extra: 'Alumnus 2025' },
        { title: 'Zara Ali', text: 'Finally a course that respects your time and teaches what matters.', extra: 'Alumna 2025' },
        { title: 'Kenji Sato', text: 'The portfolio I built here got me three job offers.', extra: 'Alumnus 2024' }
      ],
      faqs: [
        { title: 'Are courses live or recorded?', text: 'Both — live cohorts plus lifetime access to every recording and update.' },
        { title: 'Do I need experience to start?', text: 'No. Foundations tracks assume zero prior knowledge.' },
        { title: 'Is there a money-back guarantee?', text: 'Yes — 30 days, no questions asked.' }
      ],
      pricing: [
        { icon: '📖', title: 'Foundations', text: '£49', extra: 'Self-paced starter track', tag: '' },
        { icon: '🚀', title: 'Pro Track', text: '£129', extra: 'Live cohorts + mentoring', tag: 'Popular' },
        { icon: '🏫', title: 'Team & Schools', text: 'Custom', extra: 'Bulk licensing & onboarding', tag: '' }
      ],
      cta: { title: 'Start learning today', text: 'Join 3,400+ students already growing with us.' },
      aboutTitle: 'Why learners choose us', gallery: null,
      sections: ['hero', 'about', 'features', 'stats', 'pricing', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'home', keys: ['real estate', 'property', 'home', 'interior', 'construction', 'renovation', 'garden', 'plumber', 'cleaning', 'repair', 'landscaping', 'roofing', 'electrician', 'interior design', 'home renovation', 'property management', 'cleaning service', 'handyman'],
      palettes: ['emerald', 'ocean', 'sunset'], fonts: ['montserrat', 'sora', 'manrope'],
      names: ['Haven', 'TrueNorth', 'Evergreen', 'Cornerstone', 'Settle'], suffixes: ['& Co', 'Properties', 'Homes', 'Services'],
      taglines: [
        'Trusted {focus} from a local team that treats your place like their own — that\'s {brand}.',
        '{brand} makes {focus} simple: honest advice, fair prices, done right the first time.'
      ],
      about: 'For over a decade, {brand} has been the name neighbours recommend. Licensed, insured and local, we show up on time, communicate clearly and stand behind every job with a real guarantee.',
      features: [
        { icon: '🏠', title: 'Curated Listings', text: 'Hands-on guidance through every property.' },
        { icon: '📐', title: 'Free Estimates', text: 'Clear, itemised quotes before any work begins.' },
        { icon: '💼', title: 'Licensed & Insured', text: 'Fully certified — your peace of mind is included.' },
        { icon: '🤝', title: 'Local Expertise', text: 'We\'ve served this community for over a decade.' }
      ],
      stats: [
        { title: 'Jobs completed', text: '1,400+' }, { title: 'Clients served', text: '800' },
        { title: 'Years in business', text: '15' }, { title: 'Client rating', text: '5.0★' }
      ],
      testis: [
        { title: 'Beth Lawson', text: 'On time, on budget, spotless. They\'ve earned a customer for life.', extra: 'Homeowner' },
        { title: 'Ray Donovan', text: 'The quote was honest, the work was flawless, the follow-up was real.', extra: 'Homeowner' },
        { title: 'Grace Kim', text: 'They treated our home like their own. Can\'t ask for more than that.', extra: 'Client' }
      ],
      faqs: [
        { title: 'Are you licensed and insured?', text: 'Fully licensed, bonded and insured in every area we serve.' },
        { title: 'How fast can you start?', text: 'Most projects start within a week; emergencies within 24 hours.' },
        { title: 'Do you guarantee your work?', text: 'Every job carries a written warranty — details in your quote.' }
      ],
      pricing: [
        { icon: '🛠️', title: 'Repairs', text: 'From £99', extra: 'Callout + first 30 minutes', tag: '' },
        { icon: '🏡', title: 'Projects', text: 'Quote', extra: 'Renovations & builds, itemised', tag: 'Popular' },
        { icon: '📋', title: 'Maintenance', text: '£49/mo', extra: 'Seasonal care plans', tag: '' }
      ],
      cta: { title: 'Get your free estimate', text: 'Call us or send a message — we reply within one business day.' },
      aboutTitle: 'Why neighbours trust us', gallery: ['Kitchen renovation', 'Outdoor living', 'Bathroom refresh', 'Deck & garden', 'Before / after', 'Handover day'],
      sections: ['hero', 'about', 'gallery', 'features', 'stats', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'events', keys: ['event', 'events', 'wedding', 'party', 'festival', 'conference', 'gala', 'celebration', 'venue', 'catering', 'planning', 'planner', 'corporate event', 'wedding planner', 'party planning', 'birthday'],
      palettes: ['cherry', 'aurora', 'midnight'], fonts: ['playfair', 'poppins', 'pacifico'],
      names: ['Jubilee', 'Aurelia', 'Celebrate', 'Festiva', 'Lumen'], suffixes: ['Events', 'Occasions', '& Co', 'Studio'],
      taglines: [
        'Moments worth remembering start with {brand} — we craft {focus} that feel effortless and unforgettable.',
        'From first sketch to last dance, {brand} designs {focus} around the moments that matter most.'
      ],
      about: '{brand} began with a single belief: a great event should feel like magic, not logistics. Our planners, stylists and coordinators handle every detail behind the scenes — venues, vendors, timelines and those tiny surprises that make people talk about your day for years.',
      features: [
        { icon: '📅', title: 'Full Planning', text: 'Concept, budget, vendors and timeline — handled end to end.' },
        { icon: '🎨', title: 'Signature Styling', text: 'Set design, florals and lighting that look like a magazine.' },
        { icon: '🤝', title: 'On-the-Day Team', text: 'A dedicated crew so you can actually enjoy your event.' },
        { icon: '💎', title: 'Vendor Network', text: 'Trusted caterers, bands and venues, pre-vetted by us.' }
      ],
      stats: [
        { title: 'Events delivered', text: '450+' }, { title: 'Guest rating', text: '4.9★' },
        { title: 'Years planning', text: '11' }, { title: 'Weddings per year', text: '40' }
      ],
      testis: [
        { title: 'Isabelle & Marcus', text: 'They turned our sketch into the wedding of our dreams. Guests still talk about it.', extra: 'Wedding, 2025' },
        { title: 'Daniel Reyes', text: 'Our product launch ran flawlessly — logistics so smooth nobody noticed them.', extra: 'Launch event, 2025' },
        { title: 'Aisha Khan', text: 'Worth every penny. The styling alone stopped people mid-sentence.', extra: 'Anniversary gala' }
      ],
      faqs: [
        { title: 'How far ahead should we book?', text: 'Peak-season dates go 9–12 months out; intimate events need about 3 months.' },
        { title: 'Can you work with our budget?', text: 'Yes — we design within your number and tell you honestly where it stretches.' },
        { title: 'Do you cover destination events?', text: 'We love them. Travel, permits and local vendors are all part of the plan.' }
      ],
      pricing: [
        { icon: '🎈', title: 'Day Coordination', text: '£1.2k', extra: 'On-the-day team + run sheet', tag: '' },
        { icon: '✨', title: 'Full Planning', text: '£4.5k', extra: 'Concept to cleanup, unlimited calls', tag: 'Popular' },
        { icon: '👑', title: 'Signature Luxury', text: 'Custom', extra: 'Destination, styling, white glove', tag: '' }
      ],
      cta: { title: 'Let\'s plan something unforgettable', text: 'Tell us about your date and your vision — we reply within 24 hours.' },
      aboutTitle: 'The planners', gallery: ['Wedding set-up at dusk', 'Table styling detail', 'Gala reception', 'Birthday in the garden', 'Venue walkthrough', 'The last dance'],
      sections: ['hero', 'about', 'gallery', 'features', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'auto', keys: ['auto', 'car', 'cars', 'garage', 'mechanic', 'detailing', 'repair', 'motors', 'automotive', 'tyres', 'workshop', 'motorbike', 'van', 'auto repair', 'car wash', 'car dealership'],
      palettes: ['noir', 'ocean', 'cherry'], fonts: ['bebas', 'spacegrotesk', 'montserrat'],
      names: ['Ironline', 'Vantage', 'Torque', 'Velocity', 'Summit'], suffixes: ['Motors', 'Garage', 'Auto', 'Works'],
      taglines: [
        'Driven by precision — {brand} keeps your {focus} running like it\'s brand new.',
        'Honest work, real parts, fair prices. That\'s the {brand} standard for {focus}.'
      ],
      about: 'Most shops treat your car like a ticket. At {brand} we treat it like a responsibility — factory-level diagnostics, parts you can verify, and a workmanship guarantee on everything we touch. If we wouldn\'t put it on our own cars, it doesn\'t go on yours.',
      features: [
        { icon: '🔧', title: 'Factory-Level Diagnostics', text: 'Modern scanners and technicians who read the data, not just the codes.' },
        { icon: '🛡️', title: 'Warranty on Work', text: 'Every repair backed in writing — parts and labour.' },
        { icon: '🚗', title: 'All Makes & Models', text: 'From daily drivers to weekend projects, we\'ve seen it all.' },
        { icon: '⏱️', title: 'On-Time Promise', text: 'Live updates and honest timelines. No surprises at pickup.' }
      ],
      stats: [
        { title: 'Cars serviced', text: '12K+' }, { title: 'Years in the bay', text: '20' },
        { title: 'Customer rating', text: '4.8★' }, { title: 'Same-day fixes', text: '60%' }
      ],
      testis: [
        { title: 'Marcus Bell', text: 'They showed me the worn part before fixing it and charged exactly what they quoted.', extra: 'Customer since 2019' },
        { title: 'Elena Vasquez', text: 'My classic finally runs like it should. Worth every mile of the drive over.', extra: 'Classic car owner' },
        { title: 'Ray Donovan', text: 'Diagnosed in minutes what two other shops missed in weeks.', extra: 'Fleet owner' }
      ],
      faqs: [
        { title: 'Can I get a quote before work starts?', text: 'Always — written, itemised and approved by you before any wrench turns.' },
        { title: 'Do you use genuine parts?', text: 'OEM where it matters, quality alternatives where it doesn\'t — your choice, clearly priced.' },
        { title: 'Is there a courtesy car?', text: 'Yes, book ahead — plus free collection within 10km.' }
      ],
      pricing: [
        { icon: '🛞', title: 'Service', text: 'From £89', extra: 'Oil, filters, 30-point check', tag: '' },
        { icon: '🔧', title: 'Repairs', text: 'Quote', extra: 'Itemised, warranty-backed', tag: 'Popular' },
        { icon: '✨', title: 'Detailing', text: 'From £129', extra: 'Inside-out, ceramic options', tag: '' }
      ],
      cta: { title: 'Book your service bay', text: 'Call us or book online — same-week slots most days.' },
      aboutTitle: 'Our workshop', gallery: ['The workshop floor', 'Engine rebuild', 'Detailing day', 'Classic restoration', 'Diagnostics bench', 'Handover corner'],
      sections: ['hero', 'about', 'gallery', 'features', 'stats', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'music', keys: ['music', 'band', 'artist', 'musician', 'record', 'label', 'dj', 'concert', 'gig', 'studio', 'podcast', 'venue', 'recording studio', 'music production', 'producer', 'choir'],
      palettes: ['noir', 'midnight', 'candy'], fonts: ['bebas', 'spacegrotesk', 'playfair'],
      names: ['Echo', 'Resonance', 'Vinyl', 'Octave', 'Reverb'], suffixes: ['Records', 'Live', 'Studio', 'Collective'],
      taglines: [
        '{brand} makes {focus} you feel in your chest — loud, honest and impossible to ignore.',
        'Step into the sound of {brand}: {focus} crafted live, recorded raw and played for real.'
      ],
      about: '{brand} started in a garage with a four-track and too much feedback. Today we\'re a full {focus} home — recording, performing and releasing work we actually believe in, on our own terms, for people who listen close.',
      features: [
        { icon: '🎸', title: 'Live Shows', text: 'High-energy sets, festival-ready production, zero backing tracks.' },
        { icon: '🎧', title: 'Recording Studio', text: 'Full production, mixing and mastering with analog soul.' },
        { icon: '📀', title: 'Releases', text: 'Singles, EPs and albums pressed, streamed and shipped.' },
        { icon: '🎤', title: 'Lessons & Sessions', text: 'Book studio time or learn the craft from working musicians.' }
      ],
      stats: [
        { title: 'Monthly listeners', text: '180K' }, { title: 'Shows played', text: '320' },
        { title: 'Releases', text: '24' }, { title: 'Fan rating', text: '4.9★' }
      ],
      testis: [
        { title: 'Lena Kovac', text: 'Their live set rearranged my brain. Saw them twice in one month.', extra: 'Fan' },
        { title: 'Jonas Weber', text: 'The EP they produced for us sounds like a million bucks on a tenth of that.', extra: 'Artist client' },
        { title: 'Priya Nair', text: 'Booked them for our festival — best decision the committee made.', extra: 'Festival organiser' }
      ],
      faqs: [
        { title: 'Where can I hear your music?', text: 'Everywhere — Spotify, Apple Music, Bandcamp and our live shows.' },
        { title: 'Do you play private events?', text: 'Yes, from intimate acoustic sets to full festival rigs.' },
        { title: 'Can I book studio time?', text: 'Open sessions available weekly with a house engineer included.' }
      ],
      pricing: [
        { icon: '🎟️', title: 'Live Shows', text: 'From £400', extra: 'Intimate sets to full production', tag: '' },
        { icon: '🎚️', title: 'Studio Day', text: '£250', extra: '8 hours + engineer', tag: 'Popular' },
        { icon: '💿', title: 'EP Package', text: '£1.8k', extra: 'Record, mix, master, release', tag: '' }
      ],
      cta: { title: 'Come hear it live', text: 'Grab tickets or book us — the next show is always close.' },
      aboutTitle: 'The sound', gallery: ['Live at the hall', 'Studio session', 'Festival main stage', 'In the van', 'Acoustic corner', 'Press photos'],
      sections: ['hero', 'about', 'gallery', 'features', 'stats', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'nonprofit', keys: ['nonprofit', 'non profit', 'charity', 'ngo', 'foundation', 'cause', 'fundraiser', 'volunteer', 'donate', 'donation', 'community', 'relief', 'mission', 'animal rescue', 'food bank', 'fundraising'],
      palettes: ['emerald', 'ocean', 'sunset'], fonts: ['manrope', 'inter', 'sora'],
      names: ['Beacon', 'Harbor', 'Kindred', 'Openhand', 'Lumen'], suffixes: ['Foundation', 'Alliance', 'Collective', 'Initiative'],
      taglines: [
        'Small acts, huge impact — {brand} turns your {focus} into real, measurable change.',
        'Join {brand} in the work that matters: {focus} that lifts real people, right now.'
      ],
      about: '{brand} exists because good intentions aren\'t enough. Every dollar we raise is tracked, every programme we run is measured, and every volunteer hour is honoured. We keep overheads lean so your {focus} goes where it\'s needed most — and we show you exactly where that is.',
      features: [
        { icon: '💝', title: 'Direct Impact', text: 'Funds go to vetted programmes, not admin — guaranteed.' },
        { icon: '🤲', title: 'Volunteer Network', text: '2,000+ people giving time, skills and energy.' },
        { icon: '📊', title: 'Radical Transparency', text: 'Public annual reports with every dollar accounted for.' },
        { icon: '🌍', title: 'Local Roots', text: 'Community-led projects in the places we serve.' }
      ],
      stats: [
        { title: 'Lives touched', text: '38K' }, { title: 'Funds delivered', text: '£2.1M' },
        { title: 'Volunteers', text: '2,000+' }, { title: 'Programmes', text: '14' }
      ],
      testis: [
        { title: 'Grace Kim', text: 'I sponsor a child\'s schooling and get real updates, not generic emails.', extra: 'Monthly donor' },
        { title: 'Diego Ramos', text: 'Their volunteer days are the highlight of our company calendar.', extra: 'Corporate partner' },
        { title: 'Beth Lawson', text: 'They showed me the exact well my donation built. That\'s accountability.', extra: 'One-time donor' }
      ],
      faqs: [
        { title: 'Where does my donation go?', text: '91 cents of every dollar goes to programmes; the rest keeps the lights on — fully itemised.' },
        { title: 'Can I volunteer?', text: 'Absolutely — individual and team days run weekly, no experience needed.' },
        { title: 'Do you partner with companies?', text: 'We love corporate giving: matched donations, volunteering and grants.' }
      ],
      pricing: [
        { icon: '🌱', title: 'Give Once', text: '£25', extra: 'One-time gift, fully tracked', tag: '' },
        { icon: '🤝', title: 'Monthly', text: '£15/mo', extra: 'Sustains a programme year-round', tag: 'Popular' },
        { icon: '🏢', title: 'Partner', text: 'Custom', extra: 'Corporate giving + volunteering', tag: '' }
      ],
      cta: { title: 'Give a little, change a lot', text: 'Donate, volunteer or partner — every bit moves the mission.' },
      aboutTitle: 'Our mission', gallery: ['Community kitchen day', 'School supplies drive', 'Clean water handover', 'Volunteer crew', 'Youth programme', 'Harvest fundraiser'],
      sections: ['hero', 'about', 'gallery', 'features', 'stats', 'testimonials', 'faq', 'cta', 'contact']
    },
    {
      id: 'generic', keys: [],
      palettes: ['midnight', 'aurora', 'emerald', 'sunset'], fonts: ['inter', 'poppins', 'manrope'],
      names: ['Commonwealth', 'Aster', 'Larkspur', 'Cobalt', 'Wren'], suffixes: ['& Co', 'Studio', 'Group', 'Collective'],
      taglines: [
        'Welcome to {brand} — where {focus} is done properly, honestly and beautifully.',
        '{brand} exists to make {focus} effortless for the people who matter: you.'
      ],
      about: 'At {brand}, we\'re obsessed with the details others skip. Everything we do is built on quality, trust and a genuine love for the work — which is exactly why our clients keep coming back and sending their friends.',
      features: [
        { icon: '✦', title: 'Quality You Can Feel', text: 'Meticulous craft in everything we deliver.' },
        { icon: '⚡', title: 'Fast & Reliable', text: 'Clear timelines, honest updates, zero surprises.' },
        { icon: '🤝', title: 'People First', text: 'We treat every client like a neighbour, not a number.' },
        { icon: '🛡️', title: 'Backed by Warranty', text: 'Stand behind our work — always.' }
      ],
      stats: [
        { title: 'Happy clients', text: '200+' }, { title: 'Client rating', text: '4.9★' },
        { title: 'Years in business', text: '10' }, { title: 'Projects delivered', text: '350' }
      ],
      testis: [
        { title: 'Alex Rivera', text: 'Outstanding experience from start to finish. Every promise kept.', extra: 'Client' },
        { title: 'Mina Park', text: 'They understood the vision immediately and exceeded it.', extra: 'Client' },
        { title: 'Sam Oduya', text: 'The results speak for themselves. Highly recommended.', extra: 'Client' }
      ],
      faqs: [
        { title: 'How do we get started?', text: 'Reach out through the contact form — we reply within one business day.' },
        { title: 'What does it cost?', text: 'Every project is quoted individually, honestly and in writing.' },
        { title: 'Do you offer guarantees?', text: 'Yes — our work is backed by a written satisfaction guarantee.' }
      ],
      pricing: [
        { icon: '🌱', title: 'Starter', text: '£99', extra: 'Perfect for first steps', tag: '' },
        { icon: '⚡', title: 'Standard', text: '£199', extra: 'Our most popular option', tag: 'Popular' },
        { icon: '🏆', title: 'Premium', text: '£399', extra: 'Full-service, white-glove', tag: '' }
      ],
      cta: { title: 'Let\'s get started', text: 'Tell us what you need — we\'ll take it from there.' },
      aboutTitle: 'About us', gallery: ['Work one', 'Work two', 'Work three', 'Work four', 'Work five', 'Work six'],
      sections: ['hero', 'about', 'features', 'stats', 'testimonials', 'cta', 'contact']
    }
  ];

  // ---- Premium Font Pack curation (Pro perk) ----
  // Pro fonts are offered to paid users only; free generation stays on core fonts.
  const PRO_FONTS = new Set(['syne', 'unbounded', 'anton', 'archivoblack', 'righteous', 'alfaslab', 'fraunces', 'bodoni', 'cormorant', 'caveat', 'dancingscript', 'greatvibes', 'firacode', 'spacemono']);
  const FONT_BOOST = {
    tech: ['spacemono', 'unbounded'], creative: ['fraunces', 'bodoni'], food: ['cormorant', 'caveat'],
    retail: ['bodoni', 'fraunces'], travel: ['cormorant', 'dancingscript'], fitness: ['anton', 'oswald'],
    beauty: ['bodoni', 'caveat'], edu: ['lora', 'fraunces'], home: ['oswald', 'archivoblack'],
    events: ['fraunces', 'greatvibes'], auto: ['oswald', 'archivoblack'], music: ['spacemono', 'unbounded'],
    nonprofit: ['syne', 'lora'], generic: ['figtree', 'dmsans']
  };
  TYPES.forEach((t) => {
    const boost = (FONT_BOOST[t.id] || []).filter((f) => !t.fonts.includes(f));
    if (boost.length) t.fonts = t.fonts.concat(boost);
  });
  const pickFreeFont = (type, seed) => {
    const list = type.fonts.filter((f) => !PRO_FONTS.has(f));
    return pick(list.length ? list : type.fonts, seed);
  };

  function detectType(prompt) {
    // phrase-first whole-word matching: “wood-fired pizza” counts more than
    // a lone “art” inside “artisanal”, and “hair salon” beats “salon” alone.
    const norm = (s) => ' ' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    const p = norm(prompt);
    let best = TYPES[TYPES.length - 1]; // generic fallback
    let bestScore = 0;
    let bestPos = Infinity;
    for (const t of TYPES) {
      if (t.id === 'generic') continue;
      let score = 0, pos = Infinity;
      for (const k of t.keys) {
        const nk = norm(k);
        const i = p.indexOf(nk);
        if (i !== -1) {
          // longer, more specific phrases outweigh single common words
          const words = String(k).trim().split(/\s+/).filter(Boolean).length;
          score += words >= 2 ? 3 : 1;
          if (i < pos) pos = i;
        }
      }
      if (score > bestScore || (score === bestScore && score > 0 && pos < bestPos)) {
        best = t; bestScore = score; bestPos = pos;
      }
    }
    return best;
  }

  const NAME_SKIP = new Set(['studio', 'the', 'and', 'co', 'restaurant', 'cafe', 'café', 'salon', 'company', 'agency', 'band', 'club', 'group', 'city', 'town', 'london', 'paris', 'new', 'york', 'centre', 'center']);
  function brandName(prompt, type, seed) {
    const clean = (s) => String(s || '').replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
    const q = prompt.match(/"([^"]+)"/) || prompt.match(/'([^']+)'/) || prompt.match(/\bcalled\s+([A-Z][\w&.]+)/i);
    if (q) return clean(q[1]);
    // “acme, a bakery in leeds” / “acme is a bakery …” style name-first prompts
    const lead = prompt.match(/^\s*([A-Z][A-Za-z0-9&'.]+(?:\s+[A-Z][A-Za-z0-9&'.]+){0,2}),?\s+(?:is|are|\ba|\ban)\b/i);
    if (lead) {
      const nm = clean(lead[1]);
      const parts = nm.split(' ');
      const bad = parts.every((w) => NAME_SKIP.has(w.toLowerCase()) || w.length < 2);
      if (!bad) return nm;
    }
    const caps = prompt.match(/\b([A-Z][a-z]{2,})\b/g) || [];
    const stop = new Set(NAME_SKIP);
    const city = caps.find((w) => !stop.has(w.toLowerCase()) && !type.keys.some((k) => w.toLowerCase() === k)) || '';
    const base = pick(type.names, seed);
    if (city) return base + ' ' + city;
    return base + ' ' + pick(type.suffixes, seed >> 3);
  }

  // focusPhrase — defined above in the AI Studio 2.0 subject engine

  const pickPalette = (type, seed) => pick(type.palettes, seed);
  const pickFont = (type, seed) => pick(type.fonts, seed >> 2);

  function fill(s, brand, focus) {
    return s.replace(/\{brand\}/g, brand).replace(/\{focus\}/g, focus);
  }

  function sec(type, preset) {
    return {
      id: uid(),
      type,
      layout: preset.layout || '',
      title: preset.title || '',
      subtitle: preset.subtitle || '',
      text: preset.text || '',
      extra: preset.extra || '',
      image: preset.image || '',
      imageSource: preset.imageSource || '',
      imageMeta: preset.imageMeta && typeof preset.imageMeta === 'object' ? { ...preset.imageMeta } : null,
      bookingProvider: preset.bookingProvider || (type === 'booking' ? 'calendly' : ''),
      bookingUrl: preset.bookingUrl || (type === 'booking' ? preset.extra || '' : ''),
      bookingButton: preset.bookingButton || (type === 'booking' ? 'Book an appointment' : ''),
      bookingDuration: preset.bookingDuration || '',
      bookingLocation: preset.bookingLocation || '',
      items: (preset.items || []).map((it) => ({ icon: it.icon || '✦', title: it.title || '', text: it.text || '', extra: it.extra || '', tag: it.tag || '', image: it.image || '', imageMeta: it.imageMeta && typeof it.imageMeta === 'object' ? { ...it.imageMeta } : null, alt: it.alt || '' })),
      cols: (preset.cols || []).map((c) => String(c == null ? '' : c)),
      rows: (preset.rows || []).map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? '' : c)) : [])),
      animation: preset.animation || 'fade-up'
    };
  }
  // niche “extra” sections, placed sensibly inside the base flow
  function nicheExtras(niche, type, bank) {
    const out = [];
    if (!niche) return out;
    if (niche.menu) {
      out.push({
        name: 'table',
        preset: {
          type: 'table', layout: '', animation: 'fade-up',
          title: niche.menu.title || 'The menu',
          subtitle: niche.menu.subtitle || '',
          cols: niche.menu.cols || [],
          rows: niche.menu.rows || []
        },
        at: 'after-about'
      });
    }
    (niche.extraSections || []).forEach((name) => {
      if (out.some((x) => x.name === name)) return;
      const b = bank && bank[name];
      const preset = b ? { title: b.title, subtitle: b.subtitle, items: b.items } : {};
      out.push({ name, preset, at: 'before-cta' });
    });
    return out;
  }
  function insertNicheExtras(sections, extras) {
    if (!extras || !extras.length) return sections;
    const list = sections.slice();
    // build extras first (stable id order), then splice in two passes so
    // indexes computed on the original list stay correct per group
    const afterAbout = extras.filter((x) => x.at === 'after-about');
    const beforeCta = extras.filter((x) => x.at === 'before-cta');
    let aboutAt = list.findIndex((x) => x.type === 'about');
    if (aboutAt === -1) aboutAt = list.findIndex((x) => x.type !== 'hero' && x.type !== 'nav');
    if (aboutAt !== -1) {
      afterAbout.forEach((x, j) => list.splice(aboutAt + 1 + j, 0, sec(x.name, x.preset)));
    }
    let ctaAt = list.findIndex((x) => x.type === 'cta');
    if (ctaAt === -1) ctaAt = list.findIndex((x) => x.type === 'contact');
    if (ctaAt !== -1) {
      beforeCta.forEach((x, j) => list.splice(ctaAt + j, 0, sec(x.name, x.preset)));
    } else {
      beforeCta.forEach((x) => list.push(sec(x.name, x.preset)));
    }
    return list;
  }

  // shared copy bank — used by generateSite, sampleSection and enhanceSection
  function copyBank(type, brand, focus) {
    const fillS = (str) => String(str || '').replace(/\{brand\}/g, brand).replace(/\{focus\}/g, focus);
    const aboutFull = fillS(type.about || '{brand} is here for {focus}.');
    const heroText = aboutFull.length > 220 ? aboutFull.slice(0, 220).replace(/\s+\S*$/, '') + '…' : aboutFull;
    return {
      hero: { title: '', subtitle: fillS(pick(type.taglines, 0)), text: heroText, animation: 'zoom-in' },
      about: { title: type.aboutTitle, text: fillS(type.about), items: [
        { icon: '✓', title: (focus || 'The work') + ', done properly' },
        { icon: '✓', title: 'Quoted before we start' },
        { icon: '✓', title: 'We answer the phone' }
      ], animation: 'slide-left' },
      features: { title: 'Why ' + brand, subtitle: 'The things our clients mention first.', items: type.features.map((it) => ({ ...it })), animation: 'fade-up' },
      stats: { title: 'By the numbers', items: type.stats.map((it) => ({ ...it })), animation: 'fade-up' },
      gallery: { title: 'A glimpse', subtitle: 'Recent moments from our world.', items: (type.gallery || ['Work one', 'Work two', 'Work three']).map((c, i) => ({ text: c, extra: 'Featured ' + (i + 1) })), animation: 'fade-up' },
      pricing: { title: 'Simple, honest pricing', subtitle: 'No surprises. No hidden fees. Ever.', items: type.pricing.map((it) => ({ ...it })), animation: 'fade-up' },
      testimonials: { title: 'Kind words', subtitle: 'What our clients and customers say.', items: type.testis.map((it) => ({ ...it })), animation: 'fade-up' },
      faq: { title: 'Questions, answered', items: type.faqs.map((it) => ({ ...it })), animation: 'fade-up' },
      cta: { title: fillS(type.cta.title), text: type.cta.text, animation: 'bounce-in' },
      contact: { title: 'Say hello', subtitle: 'We reply within one business day.', animation: 'fade-up' }
    };
  }

  // per-type photographic subject for AI image generation
  const IMAGE_BASES = {
    tech: 'sleek modern tech office with soft blue lighting and clean desks',
    creative: 'minimal design studio with warm natural light, plants and pinned moodboards',
    food: 'rustic wooden table with fresh seasonal dishes and soft morning light',
    retail: 'curated boutique storefront with handmade goods in warm window light',
    travel: 'misty mountain ridge at golden hour with a winding trail',
    fitness: 'sunlit modern gym with clean equipment and energetic atmosphere',
    beauty: 'calm spa interior with candles, folded towels and soft greenery',
    edu: 'bright modern classroom with students collaborating on laptops',
    home: 'renovated bright interior with fresh paint and tools on a workbench',
    events: 'elegant event venue with warm string lights and beautifully set tables',
    auto: 'classic car in a clean workshop with warm workshop lighting',
    music: 'live music stage with warm spotlights and gentle haze',
    nonprofit: 'volunteers working together in warm community light',
    generic: 'a warm, inviting scene with soft natural light'
  };
  const imageBase = (prompt, typeId) => prompt || (IMAGE_BASES[typeId] || IMAGE_BASES.generic);

  // catalog layouts the AI assigns per business type when generating “creative”
  const LAYOUT_FLAVOR = {
    hero: { tech: ['split', 'terminal'], creative: ['split', 'minimal'], food: ['minimal'], retail: ['split'], travel: ['split', 'minimal'], fitness: ['terminal', 'split'], beauty: ['minimal'], edu: ['terminal', 'split'], home: ['split'], events: ['minimal', 'split'], auto: ['split', 'terminal'], music: ['terminal', 'minimal'], nonprofit: ['minimal'], generic: ['split', 'minimal'] },
    features: { tech: ['bento'], edu: ['bento'], creative: ['numbered'], beauty: ['numbered'], generic: ['bento'] },
    stats: { tech: ['band'], fitness: ['band'], edu: ['band'], home: ['band'], generic: ['band'] },
    pricing: { generic: ['stacked'] },
    testimonials: { creative: ['masonry'], beauty: ['masonry'], food: ['masonry'], travel: ['masonry'], generic: ['masonry'] },
    gallery: { creative: ['mosaic'], food: ['mosaic'], retail: ['mosaic'], travel: ['mosaic'], home: ['mosaic'], events: ['mosaic'], music: ['mosaic'], generic: ['mosaic'] },
    about: { generic: ['floating'] },
    cta: { generic: ['splash'] }
  };
  function pickLayout(typeId, secType, seed) {
    const cands = (LAYOUT_FLAVOR[secType] || {})[typeId] || (LAYOUT_FLAVOR[secType] || {}).generic || [];
    if (!cands.length) return '';
    return cands[Math.abs(seed) % cands.length];
  }

  // ---------- main generator ----------
  // per-look hero flavour (each is a valid catalog layout id)
  const LOOK_HERO = {
    editorial: ['minimal', 'split', 'minimal'],
    light:     ['split', 'minimal', ''],
    warm:      ['split', '', 'split'],
    bright:    ['split', '', 'minimal'],
    dark:      ['split', 'minimal', 'terminal'],
    bold:      ['terminal', 'split', ''],
    noir:      ['minimal', 'split', 'terminal'],
    playful:   ['minimal', '', 'split'],
    techy:     ['terminal', 'split', 'minimal'],
    minimal:   ['minimal', 'split', 'minimal']
  };

  function generateSite(prompt, opts = {}) {
    const raw = String(prompt || '').trim() || 'a modern, friendly business';
    const website = (opts && opts.website) || null;
    const webText = website && website.text ? String(website.text) : '';
    const Brief = briefLib();
    const brief = (Brief && opts && opts.brief) ? Brief.normalizeBrief(opts.brief) : null;
    const filled = !!(Brief && brief && Brief.briefFilled(brief));
    const studiedIn = Array.isArray(opts && opts.studied) ? opts.studied.filter(Boolean).slice(0, 3) : [];
    const voice = voiceFrom(brief || { voice: 'warm' });
    const onePager = !!(opts && opts.onePager);
    // a concrete subject beats an ambiguous guess (“dog grooming studio” is
    // pet care first, a creative agency never)
    let subjAll = extractSubjectAll(raw);
    let type = subjAll
      ? (TYPES.find((t) => t.id === subjAll.type) || TYPES[TYPES.length - 1])
      : detectType(raw);
    // a studied website lifts a vague prompt (“rebuild my site like ours”)
    // into a real industry + concrete subject
    if (!subjAll && type.id === 'generic' && webText) {
      const wt = detectType(webText);
      if (wt && wt.id !== 'generic') type = wt;
      const ws = extractSubjectAll(webText);
      if (ws) subjAll = ws;
    }
    const nameSeed = hash(raw.toLowerCase());
    let brand = (brief && brief.name)
      ? brief.name
      : (opts && opts.name && String(opts.name).trim())
        ? String(opts.name).trim().replace(/\s+/g, ' ')
        : (website && website.brand)
          ? String(website.brand).trim().replace(/\s+/g, ' ')
          : brandName(raw, type, nameSeed);
    let area = (brief && brief.area)
      ? brief.area
      : (opts && opts.area && String(opts.area).trim())
        ? String(opts.area).trim().replace(/\s+/g, ' ')
        : (website && website.area) ? String(website.area).trim() : '';
    if (brief && !brief.name && opts && opts.name && String(opts.name).trim()) brand = String(opts.name).trim().replace(/\s+/g, ' ');
    if (brief && !brief.area && opts && opts.area && String(opts.area).trim()) area = String(opts.area).trim().replace(/\s+/g, ' ');
    const subj = subjAll || extractSubject(raw, type.id);
    // deep niche pack: when the prompt or a studied website names a sub-niche,
    // its hand-written content layers over the industry copy bank and adds
    // real sections (e.g. a wood-fired pizzeria gets an actual menu table).
    const niche = matchNiche((raw + ' ' + webText).trim());
    const Finger = fingerprintLib();
    const salt = Number(opts && opts.salt) || 0;
    const fp = Finger
      ? Finger.make({
        name: brand,
        area,
        offer: (brief && brief.offer) || '',
        voice: (brief && brief.voice) || '',
        nicheId: (niche && niche.id) || '',
        prompt: raw,
        salt
      })
      : { key: raw.toLowerCase(), seed: nameSeed, salt: 0, prompt: raw };
    let seed = fp.seed;
    if (opts && opts.seed != null && String(opts.seed) !== '') {
      const n = Number(opts.seed);
      if (!Number.isNaN(n)) seed = n;
    }
    const jitter = (seed >>> 8) % 5;
    const effType = effectiveType(type, niche);
    const focus = (niche && niche.focus) || subj.focus || TYPE_FOCUS[type.id];
    const brandLower = brand.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const dna = pickDesignDNA(type, (raw + ' ' + webText).trim(), opts, seed + jitter);
    let tagline = fill(pick(effType.taglines, seed + jitter), brand, focus);

    const bank = copyBank(effType, brand, focus);
    // — real client knowledge from their existing website takes the wheel —
    // A filled brief keeps copy (tagline / about / reviews / service bodies).
    if (website && !filled) {
      if (website.tagline) tagline = String(website.tagline).trim();
      const aboutTxt = String(website.about || '');
      if (aboutTxt.length > 40) {
        bank.about.text = _cap(aboutTxt, 760);
        bank.about.title = 'About ' + brand;
        bank.hero.text = _cap(aboutTxt, 220);
      }
      const services = (website.services || []).filter((x) => x && x.title);
      if (services.length >= 2) {
        const poolIcons = (effType.features || []).map((f) => f.icon).filter(Boolean);
        bank.features.title = 'What we do';
        bank.features.subtitle = 'The work ' + brand + ' is known for — no jargon, no surprises.';
        bank.features.items = services.map((sv, i) => ({
          icon: (poolIcons[i % poolIcons.length]) || '✦',
          title: sv.title,
          text: sv.text || ('Planned, priced and delivered properly — ' + String(sv.title).toLowerCase() + ' done by ' + brand + '.'),
          extra: '', tag: '', image: ''
        }));
      }
      const faqs = (website.faqs || []).filter((x) => x && x.title && x.text);
      if (faqs.length >= 2) {
        bank.faq.items = faqs.map((f) => ({ icon: '❓', title: f.title, text: f.text, extra: '', tag: '' }));
      }
      const reviews = (website.reviews || []).filter((x) => x && x.text);
      if (reviews.length >= 2) {
        bank.testimonials.items = reviews.map((r) => ({
          icon: '⭐', title: r.title || 'Happy client', text: r.text, extra: r.extra || 'Google review', tag: ''
        }));
      }
    }
    if (brief && brief.offer) tagline = brief.offer;
    if (brief && (brief.proofs || []).some(Boolean) && bank.features && bank.features.items) {
      bank.features.items = bank.features.items.map((it, i) => brief.proofs[i] ? { ...it, text: brief.proofs[i] } : it);
    }
    const studiedMeta = [];
    if (studiedIn.length && bank.features) {
      const titles = [];
      studiedIn.forEach((st) => {
        const svc = (st.services || []).map((sv) => typeof sv === 'string' ? sv : (sv && sv.title)).filter(Boolean);
        studiedMeta.push({ url: st.url || '', brand: st.brand || '', services: svc });
        svc.forEach((title) => titles.push(title));
      });
      if (titles.length) {
        bank.features.items = (bank.features.items || []).map((it, i) => titles[i] ? { ...it, title: titles[i] } : it);
        const poolIcons = (effType.features || []).map((f) => f.icon).filter(Boolean);
        for (let i = bank.features.items.length; i < Math.min(titles.length, 6); i++) {
          bank.features.items.push({
            icon: poolIcons[i % (poolIcons.length || 1)] || '✦',
            title: titles[i],
            text: (brief && brief.proofs[i]) || ('Done properly by ' + brand + '.'),
            extra: '', tag: '', image: ''
          });
        }
      }
    }
    tagline = speak(tagline, voice);
    if (bank.hero && bank.hero.text) bank.hero.text = speak(bank.hero.text, voice);
    if (bank.about && bank.about.text) bank.about.text = speak(bank.about.text, voice);
    if (bank.cta) {
      if (bank.cta.title) bank.cta.title = speak(bank.cta.title, voice);
      if (bank.cta.text) bank.cta.text = speak(bank.cta.text, voice);
    }
    bank.hero = { ...bank.hero, subtitle: tagline };
    if (area && bank.about && Array.isArray(bank.about.items) && bank.about.items[1]) {
      bank.about.items[1] = { icon: '✓', title: 'Based in ' + area };
    }
    const S = (name) => {
      let preset = bank[name] || {};
      // creative mode: hand sections the catalog layouts that suit the business
      if (opts.layouts !== 'classic' && preset.title !== undefined) {
        const l = pickLayout(type.id, name, seed + jitter + (opts.seed || 0));
        if (l) preset = { ...preset, layout: l };
      }
      return preset;
    };

    let sections = (effType.sections || type.sections || []).map((name) => sec(name, S(name)));
    // deep niche packs add real sections of their own (menu tables, galleries)
    sections = insertNicheExtras(sections, nicheExtras(niche, type, bank));

    // design-DNA pass: hero treatment per look, and gentle variation so two
    // runs of the same brief don't feel identical.
    if (opts.layouts !== 'classic') {
      const heroSec = sections.find((x) => x.type === 'hero');
      if (heroSec) {
        const tray = LOOK_HERO[dna.look] || LOOK_HERO.light;
        heroSec.layout = tray[Math.abs(seed + jitter) % tray.length];
      }
      // rotate the stats band + faq columns when the look is editorial or bold
      const statsSec = sections.find((x) => x.type === 'stats');
      if (statsSec && (dna.look === 'dark' || dna.look === 'bold' || dna.look === 'techy') && Math.abs(seed) % 2 === 0) {
        statsSec.layout = 'band';
      }
      const faqSec = sections.find((x) => x.type === 'faq');
      if (faqSec && dna.look === 'editorial' && Math.abs(seed) % 2 === 0) {
        faqSec.layout = 'columns';
      }
      // occasionally drop the pricing row in favour of a cleaner flow
      if ((dna.look === 'minimal' || dna.look === 'noir') && Math.abs(seed) % 5 === 4 && sections.length > 6) {
        sections = sections.filter((x) => x.type !== 'pricing');
      }
    }
    if (Finger && opts.layouts !== 'classic') {
      sections = Finger.orderSections(sections, seed + 17);
    }

    // Local-first: when the creator names their town/area, the generated copy
    // proves local knowledge and the site gains an areaServed schema signal
    // (schema type flips to LocalBusiness automatically on export).
    const desc = fill('We\'re {brand} — helping you with {focus}, done properly.', brand, focus)
      + (area ? ' We proudly serve ' + area + ' and the surrounding areas.' : '');
    const eyebrow = area || focus || '';
    if (area) {
      const fSec = sections.find((x) => x.type === 'faq');
      if (fSec && Array.isArray(fSec.items)) {
        fSec.items.push({ icon: '📍', title: 'Do you serve ' + area + '?', text: 'Yes — we proudly serve ' + area + ' and the surrounding areas. Reach out and we’ll talk through your project.', extra: '', tag: '' });
      }
    }
    const primaryCta = (brief && brief.cta) ? speak(brief.cta, voice) : 'Get started';
    const ctaSec = sections.find((x) => x.type === 'cta');
    if (brief && brief.cta && ctaSec) {
      ctaSec.title = speak(brief.cta, voice);
      if (ctaSec.text) ctaSec.text = speak(ctaSec.text, voice);
    }
    const photoGrade = (Finger && Finger.photoGradeSpec)
      ? Finger.photoGradeSpec({ on: !!(opts && opts.photoGrade), typeId: type.id, look: dna.look })
      : { on: false, blend: 'color', strength: 0 };

    const project = {
      id: 'ai_' + Math.random().toString(36).slice(2, 10),
      name: brand + ' — Website',
      templateId: 'ai:' + type.id,
      aiType: type.id,
      aiScenes: (photoLib() && photoLib().expandScenes)
        ? photoLib().expandScenes((niche && niche.scenes) || subj.scenes || TYPE_SCENES[type.id] || TYPE_SCENES.generic)
        : ((niche && niche.scenes) || subj.scenes || TYPE_SCENES[type.id] || TYPE_SCENES.generic),
      aiSubject: focus,
      aiNiche: niche ? niche.name : '',
      aiNicheId: niche ? niche.id : '',
      dnaLook: dna.look,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      suites: [],
      site: {
        name: brand,
        tagline,
        eyebrow,
        description: desc,
        ctaText: primaryCta,
        navCta: primaryCta,
        ctaLink: '',
        email: (website && website.email) || ('hello@' + (brandLower || 'pallettai') + '.com'),
        phone: (website && website.phone) || '',
        address: (website && website.address) || '',
        area,
        url: (website && website.url) || '',
        palette: dna.palette,
        font: dna.font,
        fontDisplay: dna.fontDisplay,
        design: { containerWidth: 1140, radius: dna.radius, spacing: dna.spacing },
        sections,
        brief: brief || undefined,
        voice,
        studied: studiedMeta.length ? studiedMeta : undefined,
        fingerprint: { key: fp.key, seed: fp.seed, salt: fp.salt, prompt: raw },
        photoGrade
      }
    };
    if (filled && !onePager) splitPages(project, niche, area);
    const Composer = composeLib();
    if (Composer && Composer.applyCompose) {
      Composer.applyCompose(project, {
        typeId: type.id,
        nicheId: niche && niche.id,
        seed,
        onePager,
        layouts: opts.layouts,
        photoMode: (opts && opts.photoMode) || 'real'
      });
    }
    if (!project.site.logo) logo(project);
    // Identity pre-fill: prefer business identity stored on this device
    try {
      const rawId = (typeof localStorage!=='undefined') ? JSON.parse(localStorage.getItem('pallettai.settings.v1')||'{}') : null;
      const id = rawId && typeof rawId==='object' ? rawId : null;
      if (id) {
        if (id.businessName && String(id.businessName).trim()) project.site.name = String(id.businessName).trim();
        if (id.businessEmail && String(id.businessEmail).trim()) project.site.email = String(id.businessEmail).trim();
        if (id.businessPhone && String(id.businessPhone).trim()) project.site.phone = String(id.businessPhone).trim();
        if (id.businessAddress && String(id.businessAddress).trim()) project.site.address = String(id.businessAddress).trim();
        if (id.businessUrl && String(id.businessUrl).trim()) project.site.url = String(id.businessUrl).trim();
        if (id.businessHours && String(id.businessHours).trim()) project.site.hours = String(id.businessHours).trim();
        if (id.businessSocial && String(id.businessSocial).trim()) project.site.social = String(id.businessSocial).trim();
      }
    } catch(e) {}
    project.site.photoPass = { status: 'pending', placed: { hero: false, about: false, gallery: 0 } };
    return project;
  }

  function cloneSec(s) {
    const c = JSON.parse(JSON.stringify(s));
    c.id = uid();
    return c;
  }

  function splitPages(project, niche, area) {
    const all = (project.site && project.site.sections) || [];
    const first = (t) => all.find((s) => s.type === t);
    const hero = first('hero');
    const feat = first('features');
    const stats = first('stats');
    const testi = first('testimonials');
    const cta = first('cta');
    const about = first('about');
    const pricing = first('pricing');
    const table = first('table');
    const contact = first('contact');
    const faq = first('faq');
    const home = [];
    if (hero) home.push(hero);
    if (feat) {
      const teaser = cloneSec(feat);
      teaser.items = (teaser.items || []).slice(0, 3);
      home.push(teaser);
    }
    if (stats) home.push(stats);
    else if (testi) home.push(testi);
    if (cta) home.push(cta);
    const serviceSlug = niche && niche.menu ? 'menu' : 'services';
    const serviceName = niche && niche.menu ? 'Menu' : 'Services';
    const services = [];
    if (feat) services.push(cloneSec(feat));
    if (pricing) services.push(cloneSec(pricing));
    if (table) services.push(cloneSec(table));
    const aboutPg = [];
    if (about) aboutPg.push(cloneSec(about));
    if (stats) aboutPg.push(cloneSec(stats));
    if (testi) aboutPg.push(cloneSec(testi));
    const contactPg = [];
    if (contact) contactPg.push(cloneSec(contact));
    if (faq) contactPg.push(cloneSec(faq));
    if (area) contactPg.push(sec('map', { title: 'Find us', subtitle: 'We serve ' + area + ' and nearby.', extra: area }));
    project.site.pages = [
      { id: 'pg-home', name: 'Home', slug: 'index', sections: home },
      { id: 'pg-' + serviceSlug, name: serviceName, slug: serviceSlug, sections: services },
      { id: 'pg-about', name: 'About', slug: 'about', sections: aboutPg },
      { id: 'pg-contact', name: 'Contact', slug: 'contact', sections: contactPg }
    ];
    project.site.activePageId = 'pg-home';
    project.site.sections = home;
  }

  function applyNicheExtras(project, nicheId) {
    if (!project || !project.site) return false;
    const niche = NICHES.find((n) => n.id === nicheId) || matchNiche(String(nicheId || ''));
    if (!niche) return false;
    const type = TYPES.find((x) => x.id === project.aiType) || detectType(project.site.name || '');
    const bank = copyBank(effectiveType(type, niche), project.site.name, project.aiSubject || niche.focus);
    project.site.sections = insertNicheExtras(project.site.sections || [], nicheExtras(niche, type, bank));
    if (!project.aiNicheId) {
      project.aiNicheId = niche.id;
      project.aiNiche = niche.name;
    }
    return true;
  }

  function addServicesPage(project) {
    if (!project || !project.site) return false;
    const pages = Array.isArray(project.site.pages) ? project.site.pages : [];
    if (pages.some((p) => p.slug === 'services' || p.slug === 'menu')) return true;
    const feat = (project.site.sections || []).find((s) => s.type === 'features');
    const pricing = (project.site.sections || []).find((s) => s.type === 'pricing');
    const table = (project.site.sections || []).find((s) => s.type === 'table');
    const sections = [];
    if (feat) sections.push(cloneSec(feat));
    if (pricing) sections.push(cloneSec(pricing));
    if (table) sections.push(cloneSec(table));
    if (!sections.length) return false;
    if (!pages.length) {
      project.site.pages = [{ id: 'pg-home', name: 'Home', slug: 'index', sections: project.site.sections || [] }];
    }
    project.site.pages.push({ id: 'pg-services', name: 'Services', slug: 'services', sections });
    return true;
  }

  // ============================================================
  // Design Direction Lab — three deliberately different directions from one
  // brief. Directions are drafts until the creator chooses one, so exploration
  // never pollutes the project list or spends a second credit.
  // ============================================================
  const DIRECTION_PROFILES = [
    {
      id: 'editorial', label: 'Editorial Atelier', icon: '📰', look: 'editorial',
      blurb: 'Art-directed, expressive and premium — made to feel like a considered magazine spread.',
      order: ['hero', 'about', 'table', 'gallery', 'features', 'stats', 'testimonials', 'faq', 'pricing', 'cta', 'contact'],
      layouts: { hero: 'minimal', gallery: 'mosaic', testimonials: 'masonry', faq: 'columns' }
    },
    {
      id: 'bold', label: 'Bold Signal', icon: '⚡', look: 'bold',
      blurb: 'High-contrast, energetic and unmistakable — built to stop the scroll and drive action.',
      order: ['hero', 'features', 'stats', 'gallery', 'about', 'table', 'testimonials', 'pricing', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', features: 'bento', stats: 'band', gallery: 'mosaic' }
    },
    {
      id: 'minimal', label: 'Quiet Conversion', icon: '◌', look: 'minimal',
      blurb: 'Calm, spacious and focused — every element earns its place and the CTA stays clear.',
      order: ['hero', 'about', 'features', 'testimonials', 'cta', 'contact', 'stats', 'gallery', 'pricing', 'faq', 'table'],
      layouts: { hero: 'minimal', about: 'floating' }
    }
  ];

  function applyDirectionFlavor(project, profile, seed) {
    if (!project || !project.site || !profile) return project;
    const sections = Array.isArray(project.site.sections) ? project.site.sections : [];
    const rank = {};
    (profile.order || []).forEach((type, i) => { if (rank[type] == null) rank[type] = i; });
    project.site.sections = sections.map((s, i) => ({ s, i }))
      .sort((a, b) => (rank[a.s.type] == null ? 999 : rank[a.s.type]) - (rank[b.s.type] == null ? 999 : rank[b.s.type]) || a.i - b.i)
      .map((x) => x.s);
    Object.entries(profile.layouts || {}).forEach(([type, layout]) => {
      const sec = project.site.sections.find((s) => s.type === type);
      if (!sec) return;
      const variants = typeof DB.layoutsFor === 'function' ? DB.layoutsFor(type) : [];
      if (!variants.length || variants.some((v) => v.id === layout)) sec.layout = layout;
    });
    const hero = project.site.sections.find((s) => s.type === 'hero');
    if (hero && profile.id === 'bold') hero.layout = 'split';
    project.directionId = profile.id;
    project.directionName = profile.label;
    project.directionBlurb = profile.blurb;
    project.directionSeed = seed;
    return project;
  }

  function generateDirections(prompt, opts = {}) {
    const raw = String(prompt || '').trim() || 'a modern, friendly business';
    const base = hash(raw.toLowerCase() + 'direction-lab');
    const first = generateSite(raw, { ...opts, look: DIRECTION_PROFILES[0].look, seed: base });
    const stableName = (opts.name && String(opts.name).trim()) || first.site.name;
    return DIRECTION_PROFILES.map((profile, i) => {
      const p = i === 0 ? first : generateSite(raw, {
        ...opts,
        name: stableName,
        look: profile.look,
        seed: base + (i * 7919)
      });
      return applyDirectionFlavor(p, profile, base + i * 7919);
    });
  }

  function remixDirection(project, opts = {}) {
    if (!project || !project.site) return null;
    const copy = JSON.parse(JSON.stringify(project));
    const seed = Number(opts.seed) || hash((project.site.name || '') + Date.now());
    const looks = ['editorial', 'bold', 'minimal', 'warm', 'dark', 'playful'];
    const currentLook = copy.dnaLook || copy.directionId || '';
    let look = looks[Math.abs(seed) % looks.length];
    if (look === currentLook) look = looks[(Math.abs(seed) + 1) % looks.length];
    const profile = DIRECTION_PROFILES.find((x) => x.look === look) || DIRECTION_PROFILES[Math.abs(seed) % DIRECTION_PROFILES.length];
    const type = TYPES.find((x) => x.id === copy.aiType) || detectType(copy.site.name || '');
    const dna = pickDesignDNA(type, (copy.site.name || '') + ' ' + (copy.site.tagline || ''), { tier: opts.tier || 'free', look }, seed);
    copy.id = uid();
    copy.createdAt = copy.updatedAt = Date.now();
    copy.dnaLook = dna.look;
    copy.site.palette = dna.palette;
    copy.site.font = dna.font;
    copy.site.fontDisplay = dna.fontDisplay;
    copy.site.design = { ...(copy.site.design || {}), radius: dna.radius, spacing: dna.spacing };
    return applyDirectionFlavor(copy, { ...profile, id: 'remix', label: 'Remix · ' + profile.label }, seed);
  }

  // ============================================================
  // Publish quality gate — deterministic checks that run without a model or
  // network. The app supplies exported HTML when available; project checks
  // still work offline. Safe repairs are intentionally conservative: they
  // normalize structure and metadata, but never rewrite a client's claims.
  // ============================================================
  const QUALITY_TITLES = {
    about: 'Our story', features: 'What we do', stats: 'By the numbers', gallery: 'A glimpse',
    pricing: 'Pricing', testimonials: 'Kind words', faq: 'Questions, answered', blog: 'Latest updates',
    shop: 'Shop', logos: 'Trusted by', video: 'Watch our story', countdown: 'Coming soon',
    map: 'Find us', weather: 'Weather today', embed: 'Featured media', booking: 'Book online', contact: 'Say hello',
    cta: 'Ready to get started', table: 'The menu'
  };
  const QUALITY_ITEM_TYPES = new Set(['features', 'stats', 'pricing', 'testimonials', 'faq', 'gallery', 'blog', 'shop', 'logos', 'collection']);
  const QUALITY_IMAGE_TYPES = new Set(['hero', 'about', 'gallery', 'shop', 'collection', 'testimonials']);
  function qualityGate(project, opts = {}) {
    const p = project || {};
    const s = p.site || {};
    const rawPages = Array.isArray(s.pages) ? s.pages.filter((page) => page && typeof page === 'object') : [];
    const pages = rawPages.length ? rawPages : [{ id: 'pg-home', name: 'Home', slug: 'index', sections: Array.isArray(s.sections) ? s.sections : [] }];
    const homePage = pages.find((page) => page.slug === 'index') || pages[0];
    const sections = Array.isArray(homePage.sections) ? homePage.sections : [];
    const html = String(opts.html || '');
    const issues = [];
    const seenIds = new Set();
    const add = (id, level, msg, fix, safe) => issues.push({ id, level, msg, fix: fix || '', safe: safe !== false });
    if (!s.name || !String(s.name).trim()) add('site-name', 'error', 'The site has no business name.', 'Add a site name before publishing.');
    if (!sections.length) add('no-sections', 'error', 'The site has no sections.', 'Add a hero and contact section.');
    const hero = sections.find((x) => x && x.type === 'hero');
    if (!hero) add('no-hero', 'error', 'The home page has no hero section.', 'Add a hero so visitors immediately understand the site.');
    if (hero && !String(hero.image || '').trim()) add('missing-photos', 'warn', 'The hero has no photo yet.', 'Drop a photo on the hero, or run topic-matched photos.', false);
    if (!String(s.email || '').trim() && !String(s.phone || '').trim()) add('no-contact', 'warn', 'No email or phone is set.', 'Add at least one direct contact method in Site identity.', false);
    if (!String(s.metaDescription || '').trim()) add('meta-description', 'warn', 'No meta description is set.', 'Generate a concise description from the site copy.', true);
    else if (String(s.metaDescription).trim().length < 50 || String(s.metaDescription).trim().length > 160) add('meta-description-length', 'info', 'The meta description is ' + String(s.metaDescription).trim().length + ' characters.', 'Aim for roughly 50–160 characters.', false);
    if (!s.url) add('site-url-missing', 'info', 'No public site URL is set, so the export cannot include a canonical URL or sitemap.', 'Add the live domain in Design & branding before publishing.', false);
    else if (!/^https?:\/\//i.test(String(s.url))) add('site-url', 'warn', 'The site URL does not include http:// or https://.', 'Prefix the domain with https://.', true);
    if (!s.ctaText) add('cta-text', 'warn', 'The primary CTA has no label.', 'Use “Get started” unless the business has a clearer action.', true);
    if (s.ctaLink && /^javascript:/i.test(String(s.ctaLink))) add('unsafe-cta', 'error', 'The primary CTA contains an unsafe javascript: link.', 'Replace it with an https:// URL or an in-page #anchor.', true);
    if (s.formEndpoint && !/^https:\/\//i.test(String(s.formEndpoint))) add('form-endpoint', 'warn', 'The form delivery endpoint is not an HTTPS URL.', 'Use a secure Formspree, Web3Forms or HTTPS JSON endpoint.', false);
    if (!sections.some((x) => x && x.type === 'contact')) add('contact-section', 'warn', 'No contact section is present.', 'Add a clear way for visitors to reach the business.', true);
    if (!sections.some((x) => x && x.type === 'cta')) add('cta-section', 'info', 'No dedicated CTA section is present.', 'A focused call to action can improve conversion.', false);
    sections.forEach((sec, i) => {
      if (!sec || typeof sec !== 'object') return add('bad-section-' + i, 'error', 'Section ' + (i + 1) + ' is not valid data.', 'Remove or rebuild the invalid section.', true);
      if (typeof DB.sectionTypes === 'object' && !DB.sectionTypes[sec.type]) add('unknown-section-' + i, 'error', 'Section ' + (i + 1) + ' uses an unknown section type.', 'Remove it or choose a section from the library.', true);
      if (!sec.id || seenIds.has(sec.id)) add('section-id-' + i, 'warn', 'Section ' + (i + 1) + ' has a missing or duplicate ID.', 'Assign a unique section ID.', true);
      if (sec.id) seenIds.add(sec.id);
      if (QUALITY_TITLES[sec.type] && sec.type !== 'hero' && !String(sec.title || '').trim()) add('section-title-' + i, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' section has no title.', 'Give the section a clear heading.', true);
      if (QUALITY_ITEM_TYPES.has(sec.type) && !Array.isArray(sec.items)) add('section-items-' + i, 'warn', (sec.type + ' section has no items array.').replace(/^./, (x) => x.toUpperCase()), 'Normalize the section content.', true);
      if (QUALITY_ITEM_TYPES.has(sec.type) && Array.isArray(sec.items) && !sec.items.length) add('empty-items-' + i, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' section has no content cards.', 'Add at least one meaningful item before publishing.', false);
      if (sec.type === 'table') {
        if (!Array.isArray(sec.cols) || !sec.cols.some((col) => String(col == null ? '' : col).trim())) add('table-cols-' + i, 'warn', 'Table section has no column headings.', 'Add column headings in the section editor.', true);
        if (!Array.isArray(sec.rows) || !sec.rows.some((row) => Array.isArray(row) && row.some((cell) => String(cell == null ? '' : cell).trim()))) add('table-rows-' + i, 'warn', 'Table section has no meaningful rows.', 'Add at least one row or remove the table.', false);
        if (Array.isArray(sec.cols) && Array.isArray(sec.rows) && sec.cols.length && sec.rows.some((row) => Array.isArray(row) && row.length !== sec.cols.length)) add('table-shape-' + i, 'warn', 'Table rows do not match the number of column headings.', 'Pad or trim rows so every row has the same number of cells.', true);
      }
      if (sec.type === 'booking') {
        const bookingUrl = String(sec.bookingUrl || sec.extra || '').trim();
        if (!bookingUrl) add('booking-url-' + i, 'warn', 'Booking section has no scheduling link.', 'Paste a public HTTPS Calendly, Cal.com, TidyCal or other booking link.', false);
        else if (!/^https:\/\//i.test(bookingUrl)) add('booking-https-' + i, 'warn', 'Booking link must use HTTPS.', 'Replace it with the secure public URL from your booking provider.', false);
      }
      const hasDirectValue = (value) => String(value == null ? '' : value).trim().length > 0;
      const hasItemValue = Array.isArray(sec.items) && sec.items.some((item) => item && typeof item === 'object' && Object.values(item).some(hasDirectValue));
      const hasSectionValue = [sec.title, sec.subtitle, sec.text, sec.extra, sec.image].some(hasDirectValue) || hasItemValue || (sec.type === 'table' && Array.isArray(sec.rows) && sec.rows.some((row) => Array.isArray(row) && row.some(hasDirectValue)));
      if (sec.type !== 'hero' && !hasSectionValue) add('empty-section-' + i, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' section is empty.', 'Add meaningful content or remove the section.', false);
      if (QUALITY_IMAGE_TYPES.has(sec.type) && sec.image && (!String(sec.alt || '').trim() || /^(image|photo|picture|placeholder)$/i.test(String(sec.alt).trim()))) add('image-alt-' + i, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' image needs meaningful alt text.', 'Describe the image briefly in the section editor.', true);
      if (Array.isArray(sec.items)) sec.items.forEach((item, j) => {
        if (item && item.image && !String(item.alt || '').trim()) add('item-image-alt-' + i + '-' + j, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' card ' + (j + 1) + ' image has no alt text.', 'Describe the image briefly in the section editor.', true);
      });
      if (sec.layout && typeof DB.layoutsFor === 'function') {
        const variants = DB.layoutsFor(sec.type) || [];
        if (variants.length && !variants.some((v) => v.id === sec.layout)) add('section-layout-' + i, 'warn', '“' + sec.type + '” uses an unknown layout variant.', 'Reset the section to its default layout.', true);
      }
      const copy = [sec.title, sec.subtitle, sec.text].concat(Array.isArray(sec.items) ? sec.items.flatMap((it) => [it && it.title, it && it.text]) : []).filter(Boolean).join(' ');
      if (/lorem ipsum|your (?:title|text|content) here|replace me|coming soon placeholder/i.test(copy)) add('placeholder-' + i, 'warn', (QUALITY_TITLES[sec.type] || sec.type) + ' section still contains placeholder copy.', 'Rewrite the placeholder text before publishing.', false);
    });
    pages.filter((page) => page !== homePage).forEach((page, pageIndex) => {
      const pageName = String(page.name || page.slug || 'Page ' + (pageIndex + 2));
      const pageSections = Array.isArray(page.sections) ? page.sections : [];
      if (!pageSections.length) add('page-empty-' + pageIndex, 'warn', '“' + pageName + '” is empty.', 'Add a hero and contact section to this page.', true);
      const pageIds = new Set();
      pageSections.forEach((sec, i) => {
        if (!sec || typeof sec !== 'object') return add('page-bad-section-' + pageIndex + '-' + i, 'error', '“' + pageName + '” contains invalid section data.', 'Remove or rebuild the invalid section.', true);
        if (typeof DB.sectionTypes === 'object' && !DB.sectionTypes[sec.type]) add('page-unknown-section-' + pageIndex + '-' + i, 'error', '“' + pageName + '” uses an unknown section type.', 'Remove it or choose a section from the library.', true);
        if (!sec.id || pageIds.has(sec.id)) add('page-section-id-' + pageIndex + '-' + i, 'warn', '“' + pageName + '” has a missing or duplicate section ID.', 'Assign a unique section ID.', true);
        if (sec.id) pageIds.add(sec.id);
      });
      if (pageSections.length && !pageSections.some((sec) => sec && sec.type === 'hero')) add('page-no-hero-' + pageIndex, 'warn', '“' + pageName + '” has no hero section.', 'Add a clear opening section for this page.', true);
      if (pageSections.length && !pageSections.some((sec) => sec && sec.type === 'contact')) add('page-no-contact-' + pageIndex, 'info', '“' + pageName + '” has no contact section.', 'Link visitors to a clear way to get in touch.', false);
    });
    try {
      const pal = DB.getPalette(s.palette);
      const checks = DB.paletteChecks(pal) || [];
      const fails = checks.filter((x) => x.ratio < x.need);
      if (fails.length) add('contrast', 'warn', fails.length + ' palette text role' + (fails.length === 1 ? '' : 's') + ' below WCAG AA.', 'Switch to an AA-safe palette.', true);
    } catch (e) { add('palette', 'info', 'Palette could not be scored in this environment.', 'Review the palette in Database.', false); }
    if (html) {
      // Exported scripts contain template strings for live widgets (including
      // literal <img> snippets). Remove executable/style blocks before parsing
      // document markup so those implementation strings cannot look like broken
      // images, duplicate IDs or unsafe links.
      const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
      const titleTag = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html);
      const hasViewport = /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html);
      const hasLang = /<html\b[^>]*\blang\s*=/i.test(html);
      const hasResponsiveCss = /@media\b|@container\b|width\s*:\s*min\s*\(/i.test(html);
      const totalImg = (markup.match(/<img\b/gi) || []).length;
      const noAlt = (markup.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) || []).length;
      const emptyImages = (markup.match(/<img\b[^>]*>/gi) || []).filter((tag) => !/\bsrc\s*=\s*["'][^"']+[^"']["']/i.test(tag)).length;
      const h1s = (markup.match(/<h1(?:\s|>)/gi) || []).length;
      const duplicateHtmlIds = [];
      const htmlIds = new Set();
      (markup.match(/\bid\s*=\s*["'][^"']+["']/gi) || []).forEach((rawId) => {
        const val = rawId.replace(/^.*?["']|["']$/g, '');
        if (htmlIds.has(val) && !duplicateHtmlIds.includes(val)) duplicateHtmlIds.push(val);
        htmlIds.add(val);
      });
      // These findings are export-level observations. The one-click repair pass
      // can repair the project model, but it cannot mutate arbitrary generated
      // HTML, so never promise a safe repair for a finding that may persist.
      if (!h1s) add('html-h1', 'error', 'The exported home page has no <h1>.', 'Give the hero a title.', false);
      else if (h1s > 1) add('html-h1-many', 'info', 'The exported home page has ' + h1s + ' <h1> headings.', 'Keep one primary heading where possible.', false);
      if (!titleTag) add('html-title', 'error', 'The exported page has no <title> element.', 'Add a page title before publishing.', false);
      if (!hasViewport) add('html-viewport', 'warn', 'The export has no responsive viewport declaration.', 'Keep the generated viewport meta tag enabled.', false);
      if (!hasLang) add('html-lang', 'warn', 'The exported document does not declare a language.', 'Set the document language before publishing.', false);
      if (!hasResponsiveCss) add('html-responsive', 'warn', 'The export has no detectable mobile layout rules.', 'Use a responsive layout and test the mobile preview.', false);
      if (totalImg && noAlt) add('html-alt', 'warn', noAlt + ' exported image' + (noAlt === 1 ? '' : 's') + ' missing an alt attribute.', 'Use section titles or captions as image descriptions.', false);
      if (emptyImages) add('html-image-src', 'error', emptyImages + ' exported image' + (emptyImages === 1 ? '' : 's') + ' has no usable source URL.', 'Choose a valid image or remove the empty image slot.', false);
      if (duplicateHtmlIds.length) add('html-ids', 'error', 'The export contains duplicate IDs: ' + duplicateHtmlIds.slice(0, 3).join(', ') + '.', 'Regenerate the affected section IDs.', false);
      if (!html.includes('application/ld+json')) add('html-schema', 'warn', 'No structured data was found in the export.', 'Keep the generated schema block enabled.', false);
      if (s.url && !/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.test(html)) add('html-canonical', 'error', 'The export has a public URL but no canonical link.', 'Re-export after saving the site URL.', false);
      const anchorTags = markup.match(/<a\b[^>]*>/gi) || [];
      const anchorHrefs = anchorTags.map((tag) => (tag.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [null, ''])[1].trim());
      const badLinks = anchorHrefs.filter((href) => !href || /^javascript:/i.test(href) || /^data:/i.test(href));
      if (badLinks.length) add('html-links', 'error', badLinks.length + ' exported link' + (badLinks.length === 1 ? '' : 's') + ' is empty or unsafe.', 'Replace unsafe links with an https:// URL or an in-page #anchor.', false);
      const formTags = markup.match(/<form\b[^>]*>/gi) || [];
      const formsWithoutAction = formTags.filter((tag) => !/\baction\s*=\s*["'][^"']+["']/i.test(tag)).length;
      if (formsWithoutAction) add('html-form-action', 'warn', formsWithoutAction + ' exported form' + (formsWithoutAction === 1 ? '' : 's') + ' has no delivery action.', 'Configure a secure form endpoint before publishing.', false);
      const headingLevels = (markup.match(/<h[1-6](?:\s|>)/gi) || []).map((tag) => Number((tag.match(/h([1-6])/i) || [])[1] || 0));
      if (headingLevels.length && headingLevels[0] > 1) add('html-heading-order', 'warn', 'The first exported heading is h' + headingLevels[0] + ', not h1.', 'Give the page one primary h1 heading.', false);
      if (headingLevels.some((level, j) => j > 0 && level > headingLevels[j - 1] + 1)) add('html-heading-jump', 'info', 'The export skips a heading level.', 'Keep heading levels sequential for screen readers.', false);
      const riskyWidths = html.match(/(?:width|min-width)\s*:\s*(?:[2-9]\d{3,})px/gi) || [];
      if (riskyWidths.length) add('html-overflow-risk', 'warn', 'The export contains ' + riskyWidths.length + ' very wide fixed-width rule' + (riskyWidths.length === 1 ? '' : 's') + '.', 'Use fluid containers so the site remains safe on phones.', false);
      const meta = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i);
      if (meta && (meta[1].length < 40 || meta[1].length > 170)) add('html-meta-length', 'info', 'The exported meta description is ' + meta[1].length + ' characters.', 'Aim for roughly 50–160 characters.', false);
    }
    // Multi-page exports are separate documents. Audit every additional page
    // without treating identical IDs in different documents as duplicates.
    if (Array.isArray(opts.htmlPages) && opts.htmlPages.length > 1) {
      opts.htmlPages.forEach((doc, pageIndex) => {
        const docHtml = String((doc && doc.html) || '');
        if (!docHtml || docHtml === html) return;
        const pageName = String((doc && (doc.name || doc.slug)) || 'Page ' + (pageIndex + 1));
        const prefix = 'html-page-' + pageIndex + '-';
        const docMarkup = docHtml.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
        if (docHtml.toLowerCase().indexOf('<title') === -1) add(prefix + 'title', 'error', '“' + pageName + '” has no <title> element.', 'Add a page title before publishing.', false);
        if (!/<html[^>]*lang/i.test(docHtml)) add(prefix + 'lang', 'warn', '“' + pageName + '” does not declare a document language.', 'Set the document language before publishing.', false);
        if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(docHtml)) add(prefix + 'viewport', 'warn', '“' + pageName + '” has no responsive viewport declaration.', 'Keep the generated viewport meta tag enabled.', false);
        if (!/<h1(?:\s|>)/i.test(docMarkup)) add(prefix + 'h1', 'error', '“' + pageName + '” has no <h1> heading.', 'Give the page one primary heading.', false);
        const imgs = docMarkup.match(/<img\b[^>]*>/gi) || [];
        const noAlt = imgs.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;
        const emptySrc = imgs.filter((tag) => !/\bsrc\s*=\s*["'][^"']+[^"']["']/i.test(tag)).length;
        if (noAlt) add(prefix + 'alt', 'warn', '“' + pageName + '” has ' + noAlt + ' image' + (noAlt === 1 ? '' : 's') + ' without alt text.', 'Add descriptive alt text to every image.', false);
        if (emptySrc) add(prefix + 'image-src', 'error', '“' + pageName + '” has ' + emptySrc + ' image' + (emptySrc === 1 ? '' : 's') + ' without a usable source.', 'Choose a valid image or remove the empty image slot.', false);
        if (!/@media\b|@container\b|width\s*:\s*min\s*\(/i.test(docHtml)) add(prefix + 'responsive', 'warn', '“' + pageName + '” has no detectable mobile layout rules.', 'Use a responsive layout and test the mobile preview.', false);
        if (!docHtml.includes('application/ld+json')) add(prefix + 'schema', 'warn', '“' + pageName + '” has no structured data.', 'Keep the generated schema block enabled.', false);
        if (s.url && !/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.test(docHtml)) add(prefix + 'canonical', 'error', '“' + pageName + '” has a public URL but no canonical link.', 'Re-export after saving the site URL.', false);
      });
    }
    const errors = issues.filter((x) => x.level === 'error').length;
    const warnings = issues.filter((x) => x.level === 'warn').length;
    const safeFixes = issues.filter((x) => x.safe && x.level !== 'info').length;
    const score = Math.max(0, Math.round(100 - errors * 20 - warnings * 7));
    const letter = score >= 97 ? 'A+' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
    return { score, letter, ready: errors === 0, errors, warnings, safeFixes, issues, summary: errors ? 'Blocking issues remain.' : warnings ? 'Publishable, with improvements available.' : 'Ready to publish.' };
  }

  function repairQualityPage(project) {
    if (!project) return { changed: 0, changes: [] };
    project.site = project.site || {};
    const s = project.site;
    const changes = [];
    const change = (msg) => { changes.push(msg); };
    const brand = String(s.name || project.name || 'Your business').replace(/\s+—.*$/, '').trim() || 'Your business';
    let sections = Array.isArray(s.sections) ? s.sections.filter((x) => x && typeof x === 'object') : [];
    const knownTypes = DB.sectionTypes && typeof DB.sectionTypes === 'object' ? new Set(Object.keys(DB.sectionTypes)) : null;
    if (knownTypes) {
      const before = sections.length;
      sections = sections.filter((x) => knownTypes.has(x.type));
      if (sections.length !== before) change('Removed unknown section types that could not render safely');
    }
    if (!sections.length) {
      sections = [sec('hero', { subtitle: s.tagline || 'A better way to get started.' }), sec('contact', { title: 'Say hello' })];
      change('Added a safe hero and contact structure');
    }
    if (!sections.some((x) => x.type === 'hero')) {
      sections.unshift(sec('hero', { subtitle: s.tagline || s.description || 'Welcome — let’s build something great.' }));
      change('Added a missing hero section');
    }
    const seen = new Set();
    sections.forEach((section, i) => {
      if (!section.id || seen.has(section.id)) { section.id = 'sec_' + uid(); change('Regenerated a duplicate section ID'); }
      seen.add(section.id);
      if (QUALITY_TITLES[section.type] && section.type !== 'hero' && !String(section.title || '').trim()) {
        section.title = QUALITY_TITLES[section.type];
        change('Added a heading to the ' + section.type + ' section');
      }
      if (QUALITY_ITEM_TYPES.has(section.type) && !Array.isArray(section.items)) { section.items = []; change('Normalized the ' + section.type + ' items array'); }
      if (Array.isArray(section.items)) {
        section.items = section.items.map((item) => {
          const out = { ...(item || {}) };
          if (!out.icon) out.icon = '✦';
          if (!out.title && (out.text || out.extra)) out.title = 'Featured detail';
          if (out.image && (!String(out.alt || '').trim() || /^(image|photo|picture|placeholder)$/i.test(String(out.alt).trim()))) {
            out.alt = out.title || out.text || brand;
            change('Added meaningful alt text to an image in the ' + section.type + ' section');
          }
          return out;
        });
      }
      if (section.type === 'table') {
        const cols = Array.isArray(section.cols) ? section.cols.map((col) => String(col == null ? '' : col).trim()).filter(Boolean) : [];
        if (!cols.length) { section.cols = ['Item', 'Details', 'Price']; change('Added safe table column headings'); }
        else if (cols.length !== (section.cols || []).length) { section.cols = cols; change('Normalized table column headings'); }
        if (!Array.isArray(section.rows)) { section.rows = []; change('Normalized the table rows array'); }
        else {
          const width = section.cols.length || 1;
          const rowsBefore = section.rows.filter((row) => Array.isArray(row));
          const hadShapeIssue = rowsBefore.some((row) => row.length !== width);
          section.rows = rowsBefore.map((row) => {
            const clean = row.map((cell) => String(cell == null ? '' : cell).trim()).slice(0, width);
            while (clean.length < width) clean.push('');
            return clean;
          });
          if (rowsBefore.length !== (section.rows || []).length) change('Removed invalid table rows');
          if (hadShapeIssue) change('Normalized table row shapes');
        }
      }
      if (section.type === 'booking') {
        if (!section.bookingProvider) { section.bookingProvider = 'calendly'; change('Set Calendly as the booking provider'); }
        if (!section.bookingButton) { section.bookingButton = 'Book an appointment'; change('Added a booking button label'); }
        if (!section.bookingUrl && section.extra) { section.bookingUrl = section.extra; change('Migrated the booking URL from the legacy field'); }
        if (section.bookingUrl && !section.extra) { section.extra = section.bookingUrl; change('Kept the booking URL compatible with older exports'); }
      }
      if (section.image && (!String(section.alt || '').trim() || /^(image|photo|picture|placeholder)$/i.test(String(section.alt).trim()))) { section.alt = section.title || brand; change('Added meaningful alt text to the ' + section.type + ' image'); }
      if (section.layout && typeof DB.layoutsFor === 'function') {
        const variants = DB.layoutsFor(section.type) || [];
        if (variants.length && !variants.some((v) => v.id === section.layout)) { section.layout = ''; change('Reset an unknown ' + section.type + ' layout variant'); }
      }
    });
    if (!sections.some((x) => x.type === 'contact')) {
      sections.push(sec('contact', { title: 'Say hello' }));
      change('Added a contact section for a clear publishing path');
    }
    s.sections = sections;
    if (!s.metaDescription) {
      let meta = String(s.description || s.tagline || ('Discover ' + brand + ' — quality, care and a better way to get started.')).replace(/\s+/g, ' ').trim();
      if (meta.length < 50) meta += ' Learn more about ' + brand + ' today.';
      s.metaDescription = meta.slice(0, 160);
      change('Created an SEO meta description');
    }
    if (!s.ctaText) { s.ctaText = 'Get started'; change('Added a clear primary CTA'); }
    if (s.url && /^javascript:/i.test(String(s.url))) { s.url = ''; change('Removed an unsafe site URL'); }
    else if (s.url && !/^https?:\/\//i.test(String(s.url))) { s.url = 'https://' + String(s.url).replace(/^\/+/, ''); change('Normalized the site URL'); }
    if (s.ctaLink && /^javascript:/i.test(String(s.ctaLink))) { s.ctaLink = '#top'; change('Replaced an unsafe CTA link'); }
    if (!String(s.name || '').trim()) { s.name = brand; change('Added a safe site name'); }
    s.design = s.design || {};
    const width = Number(s.design.containerWidth);
    const radius = Number(s.design.radius);
    const spacing = Number(s.design.spacing);
    if (!width || width < 900 || width > 1680) { s.design.containerWidth = 1140; change('Normalized the container width'); }
    if (isNaN(radius) || radius < 0 || radius > 48) { s.design.radius = 20; change('Normalized the corner radius'); }
    if (isNaN(spacing) || spacing < 32 || spacing > 220) { s.design.spacing = 96; change('Normalized section spacing'); }
    try {
      const current = DB.getPalette(s.palette);
      const checks = DB.paletteChecks(current) || [];
      if (checks.some((x) => x.ratio < x.need)) {
        const safe = (DB.palettes || []).find((pal) => (DB.paletteChecks(pal) || []).every((x) => x.ratio >= x.need));
        if (safe && safe.id !== s.palette) { s.palette = safe.id; change('Switched to the first WCAG AA-safe palette'); }
      }
    } catch (e) { /* keep the chosen palette if the local library is unavailable */ }
    return { changed: changes.length, changes };
  }

  // Repair every page while preserving the page the Designer currently has
  // open. Older single-page projects still use the direct page helper above.
  function repairQuality(project) {
    if (!project || !project.site) return { changed: 0, changes: [] };
    const s = project.site;
    const pages = Array.isArray(s.pages) && s.pages.length ? s.pages : null;
    if (!pages) return repairQualityPage(project);
    const originalSections = s.sections;
    const originalActive = s.activePageId;
    const changes = [];
    pages.forEach((page) => {
      if (!page || typeof page !== 'object') return;
      s.sections = Array.isArray(page.sections) ? page.sections : [];
      const result = repairQualityPage(project);
      page.sections = s.sections;
      const prefix = page.slug === 'index' ? '' : String(page.name || page.slug || 'Page') + ': ';
      result.changes.forEach((msg) => changes.push(prefix + msg));
    });
    const active = pages.find((page) => page.id === originalActive) || pages.find((page) => page.slug === 'index') || pages[0];
    s.activePageId = active && active.id ? active.id : originalActive;
    s.sections = active && Array.isArray(active.sections) ? active.sections : (originalSections || []);
    return { changed: changes.length, changes };
  }

  // ============================================================
  // Real photos — keyless, topic-matched photography from the web.
  // Primary: Openverse (openly licensed, with creator/licence metadata).
  // Fallbacks: Wikimedia Commons, Pixabay, then Flickr-via-LoremFlickr.
  // ============================================================
  const photoCache = {};
  const photoFlights = new Map();
  const photoJson = async (url, ms = 2500, signal) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    let removeAbort = null;
    if (signal && signal.aborted) throw new Error('request_cancelled');
    if (ctrl) {
      if (signal) {
        const onAbort = () => ctrl.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }
      timer = setTimeout(() => ctrl.abort(), ms);
    }
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
      if (removeAbort) removeAbort();
    }
  };
  const cleanImageMeta = (meta) => {
    if (!meta || typeof meta !== 'object') return null;
    const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
    const out = {
      source: text(meta.source || 'Openverse', 80),
      sourceUrl: text(meta.sourceUrl || meta.foreignLandingUrl || '', 1200),
      creator: text(meta.creator || meta.author || '', 240),
      creatorUrl: text(meta.creatorUrl || '', 1200),
      license: text(meta.license || '', 160),
      licenseId: text(meta.licenseId || '', 80),
      licenseVersion: text(meta.licenseVersion || '', 40),
      licenseUrl: text(meta.licenseUrl || '', 1200),
      attribution: text(meta.attribution || '', 900),
      requiresAttribution: meta.requiresAttribution !== false,
      title: text(meta.title || '', 300),
      id: text(meta.id || '', 180)
    };
    return Object.values(out).some((value) => value !== '' && value !== false) ? out : null;
  };

  async function openverseCandidates(q, w = 1400, page = 1) {
    const key = 'ov_' + String(q) + '_' + w + '_' + page;
    if (photoCache[key]) return photoCache[key];
    if (photoFlights.has(key)) return photoFlights.get(key);
    const flight = (async () => {
      let out = [];
      try {
        if (typeof ONLINE === 'undefined' || !ONLINE.fetchOpenverseImages) return [];
        const rows = await ONLINE.fetchOpenverseImages(q, page, 14, { commercial: true });
        out = (rows || []).filter((row) => row && row.url).map((row) => ({
          url: row.url,
          w: row.width,
          h: row.height,
          title: row.title,
          src: 'Openverse',
          meta: cleanImageMeta(row.meta || {
            source: 'Openverse', title: row.title || 'Openverse image', creator: row.creator || row.author || '',
            creatorUrl: row.creatorUrl || '', sourceUrl: row.sourceUrl || '', license: row.license || '',
            licenseUrl: row.licenseUrl || '', attribution: row.attribution || '', requiresAttribution: true
          })
        }));
      } catch (e) { out = []; }
      photoCache[key] = out;
      return out;
    })();
    photoFlights.set(key, flight);
    flight.then(
      () => { if (photoFlights.get(key) === flight) photoFlights.delete(key); },
      () => { if (photoFlights.get(key) === flight) photoFlights.delete(key); }
    );
    return flight;
  }
  async function commonsCandidates(q, w = 1400) {
    const key = 'cm_' + String(q) + '_' + w;
    if (photoCache[key]) return photoCache[key];
    if (photoFlights.has(key)) return photoFlights.get(key);
    const flight = (async () => {
      let out = [];
    try {
      const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=14&gsrsearch=' +
        encodeURIComponent(String(q) + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=' + w + '&format=json&origin=*';
      const data = await photoJson(url);
      const pages = (data && data.query && data.query.pages) || {};
      out = Object.keys(pages).map((k) => pages[k]).filter((pg) => {
        const ii = (pg.imageinfo || [])[0];
        return ii && /(jpeg|jpg|png)$/i.test(ii.mime || '') && (!ii.width || ii.width >= 640);
      }).map((pg) => {
        const ii = pg.imageinfo[0];
        const em = ii.extmetadata || {};
        const value = (key) => String((em[key] && em[key].value) || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        const creator = value('Artist') || value('Credit');
        const license = value('LicenseShortName') || value('UsageTerms');
        const licenseUrl = value('LicenseUrl');
        const title = String(pg.title || '').replace(/^File:/i, '');
        return {
          url: ii.thumburl || ii.url, w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height,
          title: pg.title, src: 'Wikimedia Commons',
          meta: {
            source: 'Wikimedia Commons', title, creator, creatorUrl: '',
            sourceUrl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(String(pg.title || '').replace(/ /g, '_')),
            license: license || 'See source for licence', licenseUrl,
            licenseVersion: '', attribution: [title, creator ? 'by ' + creator : '', license].filter(Boolean).join(' — '),
            requiresAttribution: true
          }
        };
      }).slice(0, 12);
    } catch (e) { out = []; }
      photoCache[key] = out;
      return out;
    })();
    photoFlights.set(key, flight);
    flight.then(
      () => { if (photoFlights.get(key) === flight) photoFlights.delete(key); },
      () => { if (photoFlights.get(key) === flight) photoFlights.delete(key); }
    );
    return flight;
  }
  function loremUrl(q, w, h, lock) {
    const clean = String(q || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, ',').replace(/^,|,$/g, '') || 'photo';
    const segs = clean.split(',').filter(Boolean).slice(0, 3).join(',');
    return 'https://loremflickr.com/' + (w || 1200) + '/' + (h || 800) + '/' + segs + (lock != null ? '?lock=' + (Math.abs(lock) % 100000) : '');
  }
  // Walk an over-specific scene down to broader steps so niche scenes like
  // “wood fired pizza oven flame” still find real photography (Commons search
  // ANDs tokens, so long descriptive phrases return almost nothing).
  function sceneSteps(q) {
    const parts = String(q || '').toLowerCase().replace(/[^a-z0-9' -]/g, ' ').split(/[\s-]+/).filter(Boolean);
    const out = [];
    for (let n = parts.length; n >= 1; n--) {
      const cand = parts.slice(0, n).join(' ');
      if (!out.includes(cand)) out.push(cand);
    }
    return out.length ? out : ['photo'];
  }
  // Candidates for a scene across its broadened steps, deduped, up to `max`.
  async function gatherSceneCands(q, w, max, options) {
    if (options && options.online === false) return [];
    const out = [];
    const add = (rows) => (rows || []).forEach((c) => {
      if (c && c.url && !out.some((x) => x.url === c.url)) out.push(c);
    });
    for (const step of sceneSteps(q)) {
      // Openverse is the primary source: it gives us licence-aware results
      // rather than only a usable bitmap URL. Page 2 avoids first-result stock.
      add(await openverseCandidates(step, w || 800, 1));
      add(await openverseCandidates(step, w || 800, 2));
      if (out.length < (max || 8)) add(await commonsCandidates(step, w || 800));
      if (out.length >= (max || 20)) break;
    }
    return out.slice(0, max || 20);
  }
  async function mapLimit(items, limit, worker) {
    const out = new Array(items.length);
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return out;
  }

  // Best validated real photo for a scene query. When `validate` is false the
  // engine trusts the sources (offline / no-image-check mode).
  async function bestReal(q, seed, opts = {}) {
    if (!q) return null;
    const online = opts.online !== false;
    const Photos = photoLib();
    const usedUrls = opts.usedUrls || [];
    const usedTitles = opts.usedTitles || [];
    const slot = opts.slot || 'hero';
    if (online) {
      const cands = await gatherSceneCands(q, opts.w || 1400, opts.max || 20, { online: true });
      const ranked = Photos
        ? Photos.rank(cands, { slot, usedUrls, usedTitles })
        : cands;
      const n = ranked.length;
      if (n) {
        const start = Photos && Photos.pick ? 0 : (Math.abs(seed || 1) % n);
        const ordered = Photos && Photos.pick
          ? ranked
          : ranked.slice(start).concat(ranked.slice(0, start));
        for (let i = 0; i < Math.min(ordered.length, 8); i++) {
          const c = ordered[i];
          if (opts.validate === false || await loadImage(c.url, 2500)) {
            return { url: c.url, src: c.src || 'Openverse', meta: cleanImageMeta(c.meta) };
          }
        }
      }
      // Pixabay remains a useful no-attribution fallback when open collections
      // have no valid bitmap for a very specific scene.
      if (typeof ONLINE !== 'undefined' && ONLINE.pixabayKey) {
        for (const step of sceneSteps(q)) {
          const px = await ONLINE.fetchPixabay(step, 1, 12);
          const count = px.length;
          if (!count) continue;
          const start = Math.abs(seed || 1) % count;
          for (let i = 0; i < Math.min(count, 4); i++) {
            const c = px[(start + i) % count];
            if (opts.validate === false || await loadImage(c.url, 2500)) {
              return { url: c.url, src: c.src || 'Pixabay', meta: cleanImageMeta(c.meta) };
            }
          }
        }
      }
    }
    const lf = loremUrl(q, opts.w || 1400, opts.h || 900, seed);
    if (opts.validate !== false && !(await loadImage(lf, 2500))) return null;
    return { url: lf, src: 'Flickr via LoremFlickr', meta: null };
  }

  // ---------- AI images (Pollinations, free + keyless) ----------
  function imageUrl(prompt, w, h, seed) {
    const q = encodeURIComponent(String(prompt).trim() + ', professional photography, natural light, high detail, no text');
    return `https://image.pollinations.ai/prompt/${q}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;
  }

  function loadImage(url, ms = 12000) {
    return new Promise((res) => {
      const img = new Image();
      const t = setTimeout(() => { img.src = ''; res(false); }, ms);
      img.onload = () => { clearTimeout(t); res(true); };
      img.onerror = () => { clearTimeout(t); res(false); };
      img.src = url;
    });
  }

  async function generateImages(project, prompt, opts = {}) {
    // source: 'real' (topic-matched web photos — default) | 'ai' (Pollinations art) | 'none'
    // photos the creator uploaded themselves are always tried first, then
    // pictures pulled from their current website, then the chosen source.
    const source = opts.source === 'ai' ? 'ai' : (opts.source === 'none' ? 'none' : 'real');
    const online = opts.online !== false;
    const s = project.site;
    const type = detectType(prompt || project.site.name);
    const Photos = photoLib();
    const rawScenes = project.aiScenes || TYPE_SCENES[type.id] || TYPE_SCENES.generic;
    const scenes = Photos && Photos.expandScenes ? Photos.expandScenes(rawScenes) : rawScenes;
    const queryFor = (key, index, seed) => {
      if (Photos && Photos.sceneQuery) return Photos.sceneQuery(rawScenes, key === 'gallery' ? 'gallery' : key, index, seed);
      const v = scenes[key] || scenes.hero;
      if (Array.isArray(v)) return v[Math.abs((index || 0)) % v.length] || v[0];
      return v || 'photo';
    };
    const out = { hero: false, about: false, gallery: 0, source };
    const hero = s.sections.find((x) => x.type === 'hero');
    const about = s.sections.find((x) => x.type === 'about');
    const gal = s.sections.find((x) => x.type === 'gallery');
    const put = (sec, url, src, meta) => {
      if (!url || !sec) return false;
      sec.image = url;
      sec.imageSource = src || 'Web';
      sec.imageMeta = cleanImageMeta(meta);
      return true;
    };

    // ordered photo bank: the creator's uploads, then their existing site's shots
    const toEntry = (value, kind) => {
      if (value && typeof value === 'object') return { url: value.url || value.image || '', kind: value.kind || kind, meta: cleanImageMeta(value.meta || value.imageMeta) };
      return { url: value || '', kind, meta: null };
    };
    const pool = [].concat(
      (opts.photos || []).map((u) => toEntry(u, 'Your photo')),
      (opts.siteImages || []).map((u) => toEntry(u, 'From your website'))
    ).filter((x) => x.url && (String(x.url).slice(0, 5) === 'data:' || /^https?:/i.test(String(x.url)))).slice(0, 10);

    // role slots in the order the creator expects: hero → about → gallery tiles.
    // The hero/about fallbacks below reuse these wrappers — the photo-fill
    // helpers expect {sec} slots, so passing raw sections would drop the write.
    const heroSlot = hero ? { sec: hero, key: 'hero', w: 1600, h: 900 } : null;
    const aboutSlot = about ? { sec: about, key: 'about', w: 960, h: 800 } : null;
    const slots = [];
    if (heroSlot) slots.push(heroSlot);
    if (aboutSlot) slots.push(aboutSlot);
    if (gal && Array.isArray(gal.items)) {
      gal.items.slice(0, 6).forEach((it, i) => slots.push({ sec: it, key: 'gal' + i, w: 720, h: 540 }));
    }

    // validate remote pool images once, in parallel (data URLs are trusted)
    const poolReady = (await mapLimit(pool, 3, async (c) => {
      if (c.url.slice(0, 5) === 'data:' || !online) return c;
      return (await loadImage(c.url, 7000)) ? c : null;
    })).filter(Boolean);

    const filled = {};
    for (const slot of slots) {
      const cand = poolReady.shift();
      if (!cand) continue;
      if (put(slot.sec, cand.url, cand.kind, cand.meta)) {
        filled[slot.key] = true;
        if (slot.key === 'hero') out.hero = true;
        else if (slot.key === 'about') out.about = true;
        else out.gallery++;
      }
    }

    // fall back to the chosen source only for slots the creator didn't fill
    if (source === 'none') return out;
    const seedB = (s.fingerprint && s.fingerprint.seed) || hash(String(prompt || '') + ' ' + s.name);
    const base = imageBase(prompt, type.id);
    const usedUrls = [];
    const usedTitles = [];
    Object.keys(filled).forEach((key) => {
      const slot = slots.find((x) => x.key === key);
      if (slot && slot.sec && slot.sec.image) usedUrls.push(slot.sec.image);
    });
    const slotKind = (key) => (key === 'about' ? 'about' : (String(key).indexOf('gal') === 0 ? 'gallery' : 'hero'));
    const remember = (r) => {
      if (r && r.url) usedUrls.push(r.url);
      if (r && r.meta && r.meta.title) usedTitles.push(r.meta.title);
    };
    const tryAI = async (slot, q, seed) => {
      const url = imageUrl(q, slot.w, slot.h, seed);
      if (await loadImage(url, 2500)) { put(slot.sec, url, 'AI', null); return true; }
      return false;
    };
    const tryReal = async (slot, q, seed) => {
      const r = await bestReal(q, seed, {
        w: slot.w, h: slot.h, online, validate: online,
        slot: slotKind(slot.key), usedUrls, usedTitles
      });
      if (r) { put(slot.sec, r.url, r.src, r.meta); remember(r); return true; }
      return false;
    };
    const fallback = source === 'ai' ? tryAI : tryReal;

    const roleResults = await Promise.all([
      heroSlot && !filled.hero ? fallback(heroSlot, queryFor('hero', 0, seedB), seedB) : Promise.resolve(false),
      aboutSlot && !filled.about ? fallback(aboutSlot, queryFor('about', 0, seedB + 7), seedB + 7) : Promise.resolve(false)
    ]);
    if (heroSlot && !filled.hero && roleResults[0]) { out.hero = true; filled.hero = true; }
    if (aboutSlot && !filled.about && roleResults[1]) { out.about = true; filled.about = true; }
    if (gal && Array.isArray(gal.items)) {
      const galleryIndexes = gal.items.slice(0, 6).map((it, i) => ({ it, i })).filter((x) => x.it && !filled['gal' + x.i]);
      for (const { it, i } of galleryIndexes) {
        if (source === 'ai') {
          const cap = it.text || 'detail';
          if (await tryAI({ sec: it, w: 640, h: 480, key: 'gal' + i }, base + ', ' + cap, 31 + i * 7)) {
            out.gallery++; filled['gal' + i] = true;
          }
          continue;
        }
        const q = queryFor('gallery', i, seedB);
        if (await tryReal({ sec: it, w: 720, h: 540, key: 'gal' + i }, q, seedB + i * 11)) {
          out.gallery++; filled['gal' + i] = true;
        }
      }
    }
    if (s.photoPass) {
      s.photoPass = { status: (out.hero || out.about || out.gallery) ? 'done' : 'failed', placed: { hero: out.hero, about: out.about, gallery: out.gallery } };
    }
    return out;
  }

  // ============================================================
  // Photo picker — real candidate photos per slot (hero / about /
  // each gallery tile) so the creator chooses the final look
  // instead of the engine. Candidates come from the same keyless
  // sources as generateImages and are cached, so opening the
  // picker twice is cheap. Returns slots referencing the live
  // section objects — callers swap {url,src} on apply.
  // ============================================================
  async function photoPicks(project, opts = {}) {
    const online = opts.online !== false;
    const s = (project && project.site) || {};
    const raw = String(opts.prompt || '').trim() || (s.name || '') + ' ' + (s.tagline || '');
    const type = detectType(raw);
    const Photos = photoLib();
    const rawScenes = Object.assign({}, TYPE_SCENES[type.id] || TYPE_SCENES.generic || {}, project.aiScenes || {});
    const scenes = Photos && Photos.expandScenes ? Photos.expandScenes(rawScenes) : rawScenes;
    const queryFor = (key, i) => (Photos && Photos.sceneQuery) ? Photos.sceneQuery(rawScenes, key, i, 0) : (Array.isArray(scenes[key]) ? scenes[key][0] : scenes[key]);
    const hero = (s.sections || []).find((x) => x.type === 'hero');
    const about = (s.sections || []).find((x) => x.type === 'about');
    const gal = (s.sections || []).find((x) => x.type === 'gallery');
    const slots = [];
    const addSlot = (key, label, sec, scene, w, h) => {
      if (!sec) return;
      slots.push({
        key, label, sec,
        cur: sec.image || '', curSrc: sec.imageSource || '', curMeta: cleanImageMeta(sec.imageMeta),
        scene: scene || 'photo', w, h,
        pool: [], cands: [], picked: null, pickedSrc: '', pickedMeta: null, changed: false
      });
    };
    addSlot('hero', 'Hero photo', hero, queryFor('hero', 0), 1600, 900);
    addSlot('about', 'About image', about, queryFor('about', 0), 960, 800);
    if (gal && Array.isArray(gal.items)) {
      gal.items.slice(0, 6).forEach((it, i) => addSlot('gal' + i, (gal.items.length > 1 ? 'Gallery photo ' + (i + 1) : 'Gallery photo'), it, queryFor('gallery', i), 720, 540));
    }
    // current photos already in use on OTHER slots (so we never offer a
    // duplicate that would make two slots identical by accident)
    const used = new Set(slots.map((x) => x.cur).filter((u) => u && u.slice(0, 5) !== 'data:').filter(Boolean));

    await mapLimit(slots, 3, async (slot) => {
      let pool = [];
      if (online) {
        try {
          const cands = await gatherSceneCands(slot.scene, Math.max(640, slot.w), 20, { online });
          pool = cands.map((c) => ({ url: c.url, src: c.src, w: c.w, h: c.h, title: c.title, meta: cleanImageMeta(c.meta) }));
        } catch (e) { pool = []; }
        if (Photos && Photos.rank) {
          const kind = slot.key === 'about' ? 'about' : (String(slot.key).indexOf('gal') === 0 ? 'gallery' : 'hero');
          pool = Photos.rank(pool, { slot: kind, usedUrls: Array.from(used) });
        }
        if (pool.length < 2) {
          for (let l = 0; l < 3; l++) {
            pool.push({ url: loremUrl(slot.scene, slot.w, slot.h, 911 + l + Math.abs(hash(slot.key + slot.scene)) % 997), src: 'Flickr via LoremFlickr' });
          }
        }
      }
      // dedupe against other slots' current picks (only when we have choice)
      if (pool.length > 2) pool = pool.filter((c) => !used.has(c.url) || c.url === slot.cur);
      // de-dupe within the slot, keep order
      const seen = new Set();
      pool = pool.filter((c) => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });
      slot.pool = pool;
      if (!slot.pool.length && slot.cur && slot.cur.slice(0, 5) !== 'data:') {
        slot.pool.push({ url: slot.cur, src: slot.curSrc, meta: slot.curMeta });
      }
    });
    return slots;
  }

  // ============================================================
  // studySite — learn a business from its existing website
  // Fetch: direct when the site allows CORS, otherwise the free,
  // keyless allorigins proxy. Parsing is pure-string (no DOM), so
  // it behaves identically in the desktop app, browser and tests.
  // ============================================================  // common HTML entities worth decoding in studied copy (accents, dashes, quotes)
  const _ENT = { nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', ugrave: 'ù', ucirc: 'û', uuml: 'ü', oacute: 'ó', ocirc: 'ô', ouml: 'ö', iacute: 'í', icirc: 'î', iuml: 'ï', aacute: 'á', aelig: 'æ', ccedil: 'ç', oslash: 'ø', szlig: 'ß', ntilde: 'ñ', aring: 'å', deg: '°', plusmn: '±', middot: '·', bull: '•', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', times: '×', divide: '÷', laquo: '«', raquo: '»', sect: '§', para: '¶' };
  const _siteText = (html) => String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      const s = m.slice(2, -1);
      const hex = /^x/i.test(s);
      const c = parseInt(hex ? s.slice(1) : s, hex ? 16 : 10);
      try { return (c > 0 && c < 0x110000) ? String.fromCodePoint(c) : ''; } catch (e) { return ''; }
    })
    .replace(/&([a-z0-9]+);/gi, (m, name) => { const k = String(name).toLowerCase(); return k in _ENT ? _ENT[k] : m; })
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[ \t\r\n]+/g, ' ').trim();
  const _cap = (s, n) => {
    const t = _siteText(s);
    return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
  };
  const _siteMeta = (html, key) => {
    const re = /<meta[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (new RegExp('(?:name|property|itemprop)\\s*=\\s*["\\\']' + key + '["\\\']', 'i').test(m[0])) {
        const c = m[0].match(/content\s*=\s*["']([^"']*)["']/i);
        if (c) return c[1].trim();
      }
    }
    return '';
  };
  const _ldNodes = (html) => {
    const nodes = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      try { walk(JSON.parse(m[1].trim())); } catch (e) { /* not valid JSON-LD */ }
    }
    function walk(v) {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') { nodes.push(v); Object.keys(v).forEach((k) => walk(v[k])); }
    }
    return nodes;
  };
  const _ldType = (n) => [].concat(n && n['@type'] || []).join(' ');
  const _ldText = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return _siteText(v);
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(_ldText).filter(Boolean).join(' ');
    if (typeof v === 'object') return _siteText(v.name || v.text || v.url || v['@id'] || '');
    return '';
  };
  function _ipv4ToInt(h) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return null;
    const p = m.slice(1).map(Number);
    if (p.some((x) => x > 255)) return null;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }
  function _isPrivateIpv4(n) {
    if ((n >>> 24) === 0) return true;
    if ((n >>> 24) === 10) return true;
    if ((n >>> 24) === 127) return true;
    if ((n >>> 24) === 169 && ((n >>> 16) & 0xff) === 254) return true;
    if ((n >>> 24) === 172 && ((n >>> 16) & 0xff) >= 16 && ((n >>> 16) & 0xff) <= 31) return true;
    if ((n >>> 24) === 192 && ((n >>> 16) & 0xff) === 168) return true;
    if (((n & 0xffc00000) >>> 0) === 0x64400000) return true;
    if ((n >>> 28) >= 14) return true;
    return false;
  }
  function isPublicFetchUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    let h = String(u.hostname || '').trim().toLowerCase().replace(/\.$/, '');
    if (h.startsWith('[')) { h = h.slice(1); if (h.endsWith(']')) h = h.slice(0, -1); }
    if (!h) return false;
    if (h === 'localhost' || h.endsWith('.localhost') || /^(local|home)$/.test(h)) return false;
    if (/\.(local|internal|localhost|home\.arpa|onion)$/i.test(h)) return false;
    const v4 = _ipv4ToInt(h);
    if (v4 !== null) return !_isPrivateIpv4(v4);
    if (h.includes(':')) {
      if (h === '::1' || h === '0:0:0:0:0:0:0:1') return false;
      if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return false;
      if (/^::ffff:/.test(h)) {
        const mapped = _ipv4ToInt(h.slice(7));
        if (mapped !== null) return !_isPrivateIpv4(mapped);
      }
    }
    return true;
  }
  const _abs = (u, base) => { try { return new URL(String(u || ''), base || 'https://example.com').href; } catch (e) { return ''; } };
  const _hostBrand = (url) => {
    try { const h = new URL(url).hostname.replace(/^www\./, '').split('.')[0]; return h.charAt(0).toUpperCase() + h.slice(1); } catch (e) { return ''; }
  };
  const _cleanTitle = (t) => {
    const s = _siteText(t);
    const parts = s.split(/\s*[|–—-]\s*/);
    return (parts.length > 1 ? parts.slice(0, -1).join(' ') : s).trim();
  };
  const _siteEmail = (html) => {
    const m = html.match(/href\s*=\s*["']mailto:([^"'?]+)/i);
    if (m) return decodeURIComponent(m[1].trim());
    const t = _siteText(html).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return t ? t[0] : '';
  };
  const _sitePhone = (html) => {
    const m = html.match(/href\s*=\s*["']tel:([^"'?]+)/i);
    if (m) return decodeURIComponent(m[1].trim());
    const t = _siteText(html).match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/);
    return t ? t[0].trim() : '';
  };
  const HEADING_SKIP = new Set(['home', 'about', 'contact', 'contact us', 'get in touch', 'reach out', 'menu', 'gallery', 'photos', 'our work', 'portfolio', 'news', 'blog', 'reviews', 'testimonials', 'what we do', 'our services', 'services', 'products', 'faq', 'questions', 'follow us', 'subscribe', 'stay in touch', 'privacy', 'terms', 'find us', 'location', 'visit us', 'opening hours', 'team', 'our team', 'our story', 'story', 'our mission', 'mission', 'why us', 'why choose us', 'join us', 'careers', 'pricing', 'book now', 'book', 'order', 'shop', 'specials', 'sign up', 'login']);
  const _headings = (html) => {
    const out = [];
    const re = /<h([234])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = re.exec(html))) {
      const t = _cap(m[2], 60);
      const k = t.toLowerCase().replace(/^(our|the|a|an)\s+/, '');
      if (t.length >= 3 && !out.includes(t) && !HEADING_SKIP.has(k)) out.push(t);
      if (out.length >= 8) break;
    }
    return out;
  };
  async function _fetchHtmlRaw(url, ms = 12000, options) {
    if (!isPublicFetchUrl(url)) return null;
    const opts = options || {};
    const deadline = Date.now() + ms;
    const attempt = async (u) => {
      const remaining = Math.max(1, deadline - Date.now());
      if (opts.signal && opts.signal.aborted) {
        const e = new Error('Request cancelled.'); e.code = 'request_cancelled'; throw e;
      }
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null;
      let removeAbort = null;
      if (ctrl) {
        if (opts.signal) {
          const onAbort = () => ctrl.abort();
          opts.signal.addEventListener('abort', onAbort, { once: true });
          removeAbort = () => opts.signal.removeEventListener('abort', onAbort);
        }
        timer = setTimeout(() => ctrl.abort(), remaining);
      }
      try {
        const r = await fetch(u, ctrl ? { signal: ctrl.signal } : undefined);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let txt = await r.text();
        if (!/<(?:html|!doctype|title|body|h[1-6]|p\b|div\b)/i.test(txt.slice(0, 300))) {
          try { const j = JSON.parse(txt); if (j && typeof j.contents === 'string') txt = j.contents; } catch (e) { /* not JSON */ }
        }
        return txt;
      } catch (e) {
        if (opts.signal && opts.signal.aborted) { const x = new Error('Request cancelled.'); x.code = 'request_cancelled'; throw x; }
        if (e && e.name === 'AbortError') { const x = new Error('Request timed out.'); x.code = 'request_timeout'; throw x; }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
        if (removeAbort) removeAbort();
      }
    };
    try { return await attempt(url); } catch (e) {
      if (e && e.code === 'request_cancelled') throw e;
    }
    if (Date.now() >= deadline) return null;
    try { return await attempt('https://api.allorigins.win/raw?url=' + encodeURIComponent(url)); } catch (e) {
      if (e && e.code === 'request_cancelled') throw e;
    }
    return null;
  }
  // Understand a client's current website → structured knowledge for generateSite.
  // studySite('https://theirsite.com') fetches; studySite('<html>…</html>', 'https://…')
  // parses raw HTML (used by tests and offline imports). Returns null when the
  // site is unreachable — callers simply fall back to the prompt.
  async function studySite(input, baseUrl, options) {
    let html = String(input == null ? '' : input).trim();
    let base = '';
    if (/^</.test(html)) {
      base = baseUrl || 'https://example.com';
    } else {
      if (!html) return null;
      base = /^https?:\/\//i.test(html) ? html : 'https://' + html;
      if (!isPublicFetchUrl(base)) return null;
      html = await _fetchHtmlRaw(base, options && options.timeoutMs || 12000, options);
      if (!html) return null;
    }
    if (!/<(?:html|body|title|h[1-6]|p\b)/i.test(html)) return null;
    const txt = _siteText(html);
    const titleRaw = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || _siteMeta(html, 'og:title') || _siteMeta(html, 'twitter:title') || '';
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
    const brand = _siteMeta(html, 'og:site_name') || _cleanTitle(titleRaw) || _cap(h1, 60) || _hostBrand(base);
    const tagline = _cap(_siteMeta(html, 'description') || _siteMeta(html, 'og:description') || _siteMeta(html, 'twitter:description'), 200);

    // the first meaty paragraphs are the best “About us” material
    const paras = [];
    const pre = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pre.exec(html))) {
      const t = _cap(pm[1], 900);
      if (t.length > 80) paras.push(t);
      if (paras.length >= 3) break;
    }
    const about = _cap(paras.join(' '), 780);

    // JSON-LD gives the most reliable facts when present
    let biz = null, bizScore = -1;
    const faqs = [], reviews = [];
    for (const n of _ldNodes(html)) {
      const ty = _ldType(n);
      if (/(WebSite|FAQPage|Breadcrumb|ItemList|Blog|Article|BlogPosting|Person|Event|Product|VideoObject|ImageObject|Rating|Question|Answer|AggregateRating|Review|SearchAction)/i.test(ty)) {
        if (/FAQPage/i.test(ty)) {
          const main = (n.mainEntity || []);
          (Array.isArray(main) ? main : [main]).forEach((q) => {
            const qName = _ldText(q && q.name);
            const aName = _ldText(q && q.acceptedAnswer);
            if (qName && aName) faqs.push({ title: _cap(qName, 160), text: _cap(aName, 900) });
          });
        }
        if (/(Review)/i.test(ty)) {
          const body = _cap(n.reviewBody || n.description || n.text || '', 700);
          if (body.length > 40) {
            reviews.push({
              title: _cap(n.author && n.author.name, 60) || 'Happy client',
              text: body,
              extra: n.reviewRating && n.reviewRating.ratingValue ? (n.reviewRating.ratingValue + ' / 5 · Google review') : 'Google review'
            });
          }
        }
        continue;
      }
      if (!/(Business|Restaurant|Cafe|Salon|Store|Shop|Service|School|Gym|Spa|Agency|Organization|Practice|Bakery|Hotel|Bar|Studio|Clinic|Travel)/i.test(ty)) continue;
      const fields = ['name', 'description', 'telephone', 'email', 'address', 'url'].filter((k) => n[k] != null).length;
      const score = fields + (/Organization/i.test(ty) ? 2 : 0) - (/Government|EducationalOrganization/i.test(ty) ? 2 : 0);
      if (score > bizScore) { bizScore = score; biz = n; }
    }

    let email = _siteEmail(html);
    let phone = _sitePhone(html);
    let url = '';
    let address = '';
    let area = '';
    if (biz) {
      if (!email) email = _ldText(biz.email);
      if (!phone) phone = _ldText(biz.telephone);
      url = _abs(_ldText(biz.url), base) || ((html.match(/<link[^>]*rel=["']canonical["'][^>]*>/i) || [''])[0] ? ((html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i) || [])[1] || '') : '');
      const ad = (biz.address && typeof biz.address === 'object') ? biz.address : {};
      address = [ad.streetAddress, [ad.addressLocality, ad.addressRegion].filter(Boolean).join(' '), ad.postalCode, ad.addressCountry]
        .map((x) => _siteText(String(x == null ? '' : x))).filter(Boolean).join(', ');
      const sv = biz.areaServed;
      if (sv) {
        if (typeof sv === 'string') area = _siteText(sv);
        else if (Array.isArray(sv)) area = _siteText(sv.map((x) => (x && x.name) || x).join(', '));
        else if (sv.name) area = _siteText(sv.name);
      }
      if (!area && ad.addressLocality) area = _siteText(ad.addressLocality);
    }
    const canonicalLink = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i) || [])[1] || '';
    if (!url) url = _abs(canonicalLink, base) || base;

    // real photos the site already uses (their own brand imagery — great for a rebuild)
    const imgSet = [];
    const imgSeen = new Set();
    const addImg = (u, w) => {
      const a = _abs(u, base);
      if (!a || !/^https?:/i.test(a)) return;
      if (/\/\.(svg|ico)([?#]|$)/i.test(a)) return;
      const host = (a.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
      if (/(track|pixel|spacer|1x1)/i.test(host + a.slice(-40))) return;
      if (w && w < 100) return;
      if (!imgSeen.has(a)) { imgSeen.add(a); imgSet.push(a); }
    };
    const ogImg = _siteMeta(html, 'og:image');
    if (ogImg) addImg(ogImg, 400);
    if (biz) {
      const im = biz.image;
      if (im) [].concat(im).forEach((x) => addImg((x && typeof x === 'object' ? x.url : x) || '', 200));
    }
    const imre = /<img[^>]*>/gi;
    let im;
    while ((im = imre.exec(html))) {
      const tag = im[0];
      const w = parseInt((tag.match(/width\s*=\s*["']?(\d+)/i) || [])[1] || '0', 10);
      const h = parseInt((tag.match(/height\s*=\s*["']?(\d+)/i) || [])[1] || '0', 10);
      const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)/i) || [])[1] || (tag.match(/\bdata-src\s*=\s*["']([^"']+)/i) || [])[1] || '';
      if (src && !/(logo|icon|avatar|badge|spinner|placeholder)/i.test(src)) {
        const alt = (tag.match(/\balt\s*=\s*["']([^"']*)/i) || [])[1] || '';
        addImg(src, Math.max(w, h));
        if (alt && imgSet.length < 8) { /* keep order */ }
      }
      if (imgSet.length >= 12) break;
    }
    const images = imgSet.slice(0, 9);
    if (!images.length && biz && biz.image) images.push(_abs((typeof biz.image === 'string' ? biz.image : biz.image.url) || '', base));

    const services = [];
    if (biz && biz.serviceType) [].concat(biz.serviceType).slice(0, 6).forEach((x) => services.push({ title: _cap(x, 60), text: '' }));
    if (services.length < 2) _headings(html).forEach((t) => { if (services.length < 6 && !services.some((x) => x.title.toLowerCase() === t.toLowerCase())) services.push({ title: t, text: '' }); });

    const combined = _cap([brand, tagline, about, services.map((x) => x.title).join(' '), txt].filter(Boolean).join(' '), 6000);
    return {
      ok: true, brand: _cap(brand, 80), tagline, about, email, phone, address: _cap(address, 220), area: _cap(area, 90),
      url, images, services: services.slice(0, 6), faqs: faqs.slice(0, 6), reviews: reviews.slice(0, 3), text: combined
    };
  }

  // ---------- copy enhancement ----------
  async function onlinePolish(text, prompt) {
    // Free, keyless text model from Pollinations — best-effort only.
    const sys = 'You are PallettAI Studio, a senior web copywriter. Return only the requested copy, max 40 words, no quotes or markdown.';
    const url = 'https://text.pollinations.ai/' + encodeURIComponent(prompt) +
      '?model=openai&json=true&system=' + encodeURIComponent(sys) + '&max_tokens=160';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let out = '';
      try {
        const data = await res.json();
        out = String(data.content || data.output || '').trim();
      } catch (e) {
        const txt = await res.text().catch(() => '');
        out = String(txt || '').trim();
      }
      clearTimeout(t);
      // strip markdown artifacts and clamp length
      out = out.replace(/^["']+|["']+$/g, '').replace(/[*_`#]+/g, '').replace(/^[-–]\s+/gm, '').trim();
      if (out.length > 240) out = out.slice(0, 240).trim() + '…';
      return out.length > 12 ? out : null;
    } catch (e) {
      clearTimeout(t);
      return null;
    }
  }

  function nicheForProject(project) {
    if (!project || !project.site) return null;
    if (project.aiNicheId) return NICHES.find((n) => n.id === project.aiNicheId) || null;
    return matchNiche((project.site.name || '') + ' ' + (project.site.tagline || '') + ' ' + (project.aiSubject || ''));
  }

  function localPolish(project) {
    const type = TYPES.find((x) => x.id === project.aiType) || detectType(project.site.name);
    const brand = project.site.name;
    const focus = project.aiSubject || focusPhrase(project.site.name + ' ' + (project.site.tagline || ''));
    const s = project.site;
    const effType = effectiveType(type, nicheForProject(project));
    const bank = copyBank(effType, brand, focus);
    let applied = 0;
    s.eyebrow = 'Welcome to ' + brand;
    // rotate to a different variant than the current one so the polish is always visible
    const cur = s.tagline;
    let tIdx = hash(brand) % effType.taglines.length;
    const variants = effType.taglines.length;
    for (let i = 0; i < variants; i++) {
      const cand = fill(effType.taglines[(tIdx + i) % variants], brand, focus);
      if (cand !== cur) { s.tagline = cand; break; }
    }
    const hero = s.sections.find((x) => x.type === 'hero');
    if (hero) { hero.subtitle = s.tagline; hero.text = bank.hero.text; applied++; }
    const features = s.sections.find((x) => x.type === 'features');
    if (features) { features.items = bank.features.items.map((it) => ({ ...it })); features.title = bank.features.title; applied++; }
    const stats = s.sections.find((x) => x.type === 'stats');
    if (stats) { stats.items = bank.stats.items.map((it) => ({ ...it })); applied++; }
    const pricing = s.sections.find((x) => x.type === 'pricing');
    if (pricing) { pricing.items = bank.pricing.items.map((it) => ({ ...it })); applied++; }
    const testis = s.sections.find((x) => x.type === 'testimonials');
    if (testis) { testis.items = bank.testimonials.items.map((it) => ({ ...it })); applied++; }
    const faq = s.sections.find((x) => x.type === 'faq');
    if (faq) { faq.items = bank.faq.items.map((it) => ({ ...it })); applied++; }
    const gal = s.sections.find((x) => x.type === 'gallery');
    if (gal && bank.gallery.items.length) {
      gal.items = gal.items.map((it, i) => ({ ...it, text: bank.gallery.items[i % bank.gallery.items.length].text }));
      applied++;
    }
    const cta = s.sections.find((x) => x.type === 'cta');
    if (cta) { cta.title = bank.cta.title; cta.text = bank.cta.text; applied++; }
    const about = s.sections.find((x) => x.type === 'about');
    if (about) { about.text = bank.about.text; applied++; }
    return { applied, source: 'local' };
  }

  async function enhanceCopy(project, prompt, onlineEnabled = true) {
    if (onlineEnabled) {
      const hero = project.site.sections.find((x) => x.type === 'hero');
      const res = await onlinePolish(hero ? 'Write a punchy 30-word intro paragraph for ' + project.site.name + ', a ' + (prompt || project.site.tagline) + '. Tone: warm, confident, client-facing.' : prompt, '');
      if (res) {
        if (hero) { hero.text = res; project.site.description = res; }
        return { applied: 1, source: 'ai' };
      }
    }
    const r = localPolish(project);
    return { applied: r.applied, source: 'local' };
  }

  // ---------- AI design helpers ----------
  function restyle(project, prompt, tier) {
    const type = detectType(prompt || project.site.name);
    const seed = hash(String(prompt || '') + project.site.name + ((Date.now() / 1000) | 0) % 97);
    const dna = pickDesignDNA(type, String(prompt || project.site.name), { tier }, seed);
    let { palette: pal, font: fnt, fontDisplay: fntD } = dna;
    // make sure the restyle is visible: nudge if nothing at all changed
    const same = pal === project.site.palette && fnt === project.site.font && !fntD;
    if (same) {
      const fam = aaPaletteIds(LOOK_PALETTES[LOOK_STYLE[dna.look].pal] || LOOK_PALETTES.light);
      pal = fam[(Math.abs(seed) + 1) % (fam.length || 1)] || pal;
    }
    project.site.palette = pal;
    project.site.font = fnt;
    project.site.fontDisplay = fntD;
    project.site.design = project.site.design || {};
    if (!project.site.stylePack) {
      project.site.design.radius = dna.radius;
      project.site.design.spacing = dna.spacing;
    }
    return { palette: pal, font: fnt, fontDisplay: fntD, look: dna.look, type: type.id };
  }

  function shuffleLook(project, opts = {}) {
    const Finger = fingerprintLib();
    if (!Finger || !project || !project.site) return null;
    const prev = project.site.fingerprint || {};
    const brief = project.site.brief || {};
    const voiceTone = (project.site.voice && project.site.voice.tone) || brief.voice || '';
    const prompt = prev.prompt || ((project.site.name || '') + ' ' + (project.site.tagline || ''));
    const type = TYPES.find((x) => x.id === project.aiType) || detectType(project.site.name || prompt);
    let salt = Finger.nextSalt(prev.salt);
    let fp = Finger.make({
      name: project.site.name,
      area: project.site.area,
      offer: brief.offer || '',
      voice: voiceTone,
      nicheId: project.aiNicheId || '',
      prompt,
      salt
    });
    let dna = pickDesignDNA(type, prompt, { tier: opts.tier || 'free' }, fp.seed);
    const heroSec = (project.site.sections || []).find((x) => x.type === 'hero');
    const visual = (d, h) => [d.palette, d.font, d.fontDisplay || '', d.radius, (h && h.layout) || ''].join('|');
    const trayFor = (look) => LOOK_HERO[look] || LOOK_HERO.light;
    let nextHero = heroSec ? trayFor(dna.look)[Math.abs(fp.seed) % trayFor(dna.look).length] : '';
    const before = visual({
      palette: project.site.palette,
      font: project.site.font,
      fontDisplay: project.site.fontDisplay || '',
      radius: (project.site.design && project.site.design.radius) || ''
    }, heroSec);
    for (let i = 0; i < 8 && visual(dna, { layout: nextHero }) === before; i++) {
      salt += 1;
      fp = Finger.make({
        name: project.site.name,
        area: project.site.area,
        offer: brief.offer || '',
        voice: voiceTone,
        nicheId: project.aiNicheId || '',
        prompt,
        salt
      });
      dna = pickDesignDNA(type, prompt, { tier: opts.tier || 'free' }, fp.seed);
      nextHero = heroSec ? trayFor(dna.look)[Math.abs(fp.seed) % trayFor(dna.look).length] : '';
    }
    project.dnaLook = dna.look;
    project.site.palette = dna.palette;
    project.site.font = dna.font;
    project.site.fontDisplay = dna.fontDisplay;
    project.site.design = project.site.design || {};
    if (!project.site.stylePack) {
      project.site.design.radius = dna.radius;
      project.site.design.spacing = dna.spacing;
    }
    if (heroSec && opts.layouts !== 'classic') heroSec.layout = nextHero;
    if (project.site.photoGrade && project.site.photoGrade.on) {
      project.site.photoGrade = Finger.photoGradeSpec({ on: true, typeId: type.id, look: dna.look });
    }
    project.site.fingerprint = { key: fp.key, seed: fp.seed, salt: fp.salt, prompt };
    project.updatedAt = Date.now();
    return { palette: dna.palette, font: dna.font, fontDisplay: dna.fontDisplay, look: dna.look, salt: fp.salt };
  }

  function localSectionText(section, prompt, project) {
    const brand = project.site.name;
    const topic = prompt || section.title || 'this';
    return `At ${brand}, ${String(topic).toLowerCase()} is where we shine — crafted with care, delivered with consistency, and measured by the results our clients feel from day one.`;
  }

  async function enhanceSection(section, prompt, project, onlineEnabled) {
    const voice = project && project.site ? voiceFrom(project.site.brief, project.site.voice) : voiceFrom({ voice: 'warm' });
    const itemTypes = ['features', 'stats', 'pricing', 'testimonials', 'faq', 'blog', 'shop', 'gallery', 'logos'];
    if (itemTypes.includes(section.type)) {
      // local: reuse the business-type copy bank so every item type gets refreshed
      const type = TYPES.find((x) => x.id === project.aiType) || detectType(project.site.name);
      const bank = copyBank(effectiveType(type, nicheForProject(project)), project.site.name, project.aiSubject || focusPhrase(project.site.name + ' ' + (project.site.tagline || '')));
      const fresh = bank[section.type];
      let n = 0;
      if (fresh && fresh.items && fresh.items.length) {
        section.items = fresh.items.map((it) => ({
          ...it,
          title: speak(it.title || '', voice),
          text: speak(it.text || '', voice)
        }));
        n += section.items.length;
      }
      if (fresh && fresh.title) { section.title = speak(fresh.title, voice); n++; }
      if (fresh && fresh.subtitle) section.subtitle = speak(fresh.subtitle, voice);
      return { applied: n, source: 'local' };
    }
    if (onlineEnabled) {
      const res = await onlinePolish(
        'Write 2 punchy sentences (max 40 words) for the "' + (section.title || section.type) + '" section of ' + project.site.name + '\'s website. Warm, confident, client-facing.',
        '');
      if (res) {
        section.text = speak(res, voice);
        return { applied: 1, source: 'ai' };
      }
    }
    section.text = speak(localSectionText(section, prompt, project), voice);
    return { applied: 1, source: 'local' };
  }

  // ============================================================
  // Logo Studio — eight logo styles, fully parametrized
  // ============================================================
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const LOGO_FONTS = {
    inter: 'Inter', poppins: 'Poppins', spacegrotesk: 'Space Grotesk', sora: 'Sora',
    manrope: 'Manrope', montserrat: 'Montserrat', playfair: 'Playfair Display', dmserif: 'DM Serif Display', newsreader: 'Newsreader',
    bebas: 'Bebas Neue', pacifico: 'Pacifico', jetbrains: 'JetBrains Mono',
    plusjakarta: 'Plus Jakarta Sans', dmsans: 'DM Sans', figtree: 'Figtree', oswald: 'Oswald',
    lora: 'Lora', sourceserif: 'Source Serif 4', merriweather: 'Merriweather', raleway: 'Raleway', worksans: 'Work Sans',
    syne: 'Syne', unbounded: 'Unbounded', anton: 'Anton', archivoblack: 'Archivo Black',
    righteous: 'Righteous', alfaslab: 'Alfa Slab One', fraunces: 'Fraunces', bodoni: 'Bodoni Moda',
    cormorant: 'Cormorant Garamond', caveat: 'Caveat', dancingscript: 'Dancing Script', greatvibes: 'Great Vibes',
    firacode: 'Fira Code', spacemono: 'Space Mono'
  };

  // curated duotone pairs (used when the user isn't on palette-auto)
  const LOGO_DUOTONES = [
    { id: 'auto', name: 'From palette' },
    { id: 'sunset', name: 'Sunset', c: ['#ff6b6b', '#ffd166'] },
    { id: 'ocean', name: 'Ocean', c: ['#4facfe', '#00f2fe'] },
    { id: 'royal', name: 'Royal', c: ['#7c5cff', '#22d3ee'] },
    { id: 'forest', name: 'Forest', c: ['#2dd4a0', '#84cc16'] },
    { id: 'rose', name: 'Rose', c: ['#f472b6', '#c084fc'] },
    { id: 'gold', name: 'Gold', c: ['#f5c56b', '#b97b1f'] },
    { id: 'ember', name: 'Ember', c: ['#ff9a3d', '#e63946'] },
    { id: 'mono', name: 'Mono', c: ['#2b2f45', '#565e7d'] }
  ];

  // geometric container paths — shared by monogram / outline / badge tile
  const shapePath = (shape, s = 224, x = 16, y = 16) => {
    const cx = x + s / 2, cy = y + s / 2;
    if (shape === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${s / 2}"/>`;
    if (shape === 'hexagon') {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i - 30);
        pts.push((cx + s / 2 * Math.cos(a)).toFixed(1) + ',' + (cy + s / 2 * Math.sin(a)).toFixed(1));
      }
      return `<path d="M${pts.join('L')}Z"/>`;
    }
    if (shape === 'diamond') return `<path d="M${cx},${y}L${x + s},${cy}L${cx},${y + s}L${x},${cy}Z"/>`;
    if (shape === 'pill') return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s / 2}"/>`;
    return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="44"/>`;
  };

  // per-style preview glyph used by the studio UI
  const STYLE_GLYPHS = { monogram: '▣', wordmark: 'Aa', badge: '◉', mark: '✦', outline: '◻', duotone: '◎', seal: '⬤', combo: '◆Aa' };

  function logoColors(project, pairId) {
    const pal = DB.getPalette(project.site.palette);
    const pair = LOGO_DUOTONES.find((p) => p.id === pairId) || LOGO_DUOTONES[0];
    if (pair.id === 'auto') return [pal.primary, pal.accent];
    return pair.c;
  }

  // render one logo as an SVG data URI. spec: {style, shape, font, colors:[c1,c2], text, seed}
  function logoPreview(project, spec = {}) {
    const brand = (project && project.site && project.site.name) || 'PallettAI';
    const style = spec.style || 'monogram';
    const shape = spec.shape || 'square';
    const fontId = spec.font || (project && project.site && project.site.font) || 'inter';
    const fam = LOGO_FONTS[fontId] || 'Inter';
    const [c1, c2] = spec.colors && spec.colors.length === 2 ? spec.colors : logoColors(project, spec.pair || 'auto');
    const seed = spec.seed || 0;
    const text = String(spec.text || brand).trim() || brand;
    const initial = text.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'P';
    const et = xmlEsc(text);
    const ei = xmlEsc(initial);
    const grad = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    const year = String(new Date().getFullYear());
    const deco = (v) => (Math.abs(v) % 2 === 0);
    const rnd = (n) => Math.abs(seed * 7 + n * 13) % 100 / 100;

    let svg = '';
    if (style === 'monogram') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>${grad('g')}</defs>${shapePath(shape)}<text x="128" y="172" font-family="${fam}" font-size="118" font-weight="800" fill="#fff" text-anchor="middle">${ei}</text></svg>`;
    } else if (style === 'wordmark') {
      const accent = deco(seed) ? `<circle cx="150" cy="${110 - (Math.abs(seed) % 5) * 4}" r="5" fill="${c2}"/>` : `<rect x="104" y="104" width="92" height="6" rx="3" fill="${c2}"/>`;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 128"><defs>${grad('g')}</defs><text x="150" y="86" font-family="${fam}" font-size="62" font-weight="800" fill="url(#g)" text-anchor="middle" letter-spacing="${(rnd(3) * 2).toFixed(1)}">${et}</text>${accent}</svg>`;
    } else if (style === 'badge') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>${grad('g')}<path id="arc" d="M 52,132 A 80,80 0 0 1 204,132" fill="none"/></defs><circle cx="128" cy="128" r="122" fill="${c1}" opacity="0.10"/><circle cx="128" cy="128" r="118" fill="none" stroke="url(#g)" stroke-width="15"/><text font-size="21" letter-spacing="4" fill="${c1}" font-family="${fam}" font-weight="700"><textPath href="#arc" startOffset="50%" text-anchor="middle">${et.toUpperCase()}</textPath></text><text x="128" y="152" font-family="${fam}" font-size="74" font-weight="800" fill="url(#g)" text-anchor="middle">${ei}</text></svg>`;
    } else if (style === 'mark') {
      const pattern = Math.abs(seed) % 3;
      const tiles = pattern === 0
        ? `<rect x="28" y="28" width="64" height="64" rx="14" fill="${c1}" transform="rotate(45 60 60)"/><rect x="28" y="28" width="64" height="64" rx="14" fill="${c2}" opacity=".85" transform="translate(22 0) rotate(45 60 60)"/>`
        : pattern === 1
          ? `<circle cx="52" cy="60" r="30" fill="${c1}"/><circle cx="88" cy="60" r="30" fill="${c2}"/><circle cx="70" cy="60" r="12" fill="#fff"/>`
          : `<path d="M60 22 L98 60 L60 98 L22 60 Z" fill="${c1}"/><path d="M60 46 L82 60 L60 74 L38 60 Z" fill="${c2}"/>`;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><defs>${grad('g')}</defs>${tiles}<text x="150" y="78" font-family="${fam}" font-size="52" font-weight="800" fill="url(#g)" text-anchor="middle" letter-spacing="${(rnd(4) * 1.5).toFixed(1)}">${et}</text></svg>`;
    } else if (style === 'outline') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g fill="none" stroke="${c1}" stroke-width="9">${shapePath(shape, 214, 21, 21)}</g><text x="128" y="163" font-family="${fam}" font-size="102" font-weight="800" fill="none" stroke="${c2}" stroke-width="5" text-anchor="middle">${ei}</text></svg>`;
    } else if (style === 'duotone') {
      const gap = 12 + rnd(7) * 14;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="${128 - gap}" cy="128" r="84" fill="${c1}"/><circle cx="${128 + gap}" cy="128" r="84" fill="${c2}" opacity=".92"/><text x="128" y="160" font-family="${fam}" font-size="100" font-weight="800" fill="#fff" text-anchor="middle">${ei}</text></svg>`;
    } else if (style === 'seal') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><path id="sealArc" d="M 58,142 A 84,84 0 0 1 198,142" fill="none"/></defs><circle cx="128" cy="128" r="120" fill="url(#g)"/><circle cx="128" cy="128" r="104" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-dasharray="2 7"/><circle cx="128" cy="128" r="96" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="5"/><text font-size="20" letter-spacing="4" fill="#fff" font-family="${fam}" font-weight="700"><textPath href="#sealArc" startOffset="50%" text-anchor="middle">${et.toUpperCase()}</textPath></text><text x="128" y="92" font-size="14" fill="#fff" opacity=".85" text-anchor="middle" letter-spacing="8">✦ EST ${year} ✦</text><text x="128" y="163" font-family="${fam}" font-size="82" font-weight="800" fill="#fff" text-anchor="middle">${ei}</text></svg>`;
    } else if (style === 'combo') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 140"><defs>${grad('g')}</defs><g transform="translate(18 18) scale(0.42)">${shapePath(shape)}</g><g transform="translate(18 18) scale(0.42)"><text x="128" y="172" font-family="${fam}" font-size="118" font-weight="800" fill="#fff" text-anchor="middle">${ei}</text></g><text x="150" y="94" font-family="${fam}" font-size="56" font-weight="800" fill="url(#g)" text-anchor="middle" letter-spacing="${(rnd(5) * 1.6).toFixed(1)}">${et}</text></svg>`;
    }
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const LOGO_STYLES = [
    { id: 'monogram', name: 'Monogram', shapeable: true },
    { id: 'wordmark', name: 'Wordmark', shapeable: false },
    { id: 'badge', name: 'Badge', shapeable: false },
    { id: 'mark', name: 'Abstract Mark', shapeable: false },
    { id: 'outline', name: 'Outline', shapeable: true },
    { id: 'duotone', name: 'Duotone', shapeable: false },
    { id: 'seal', name: 'Seal', shapeable: false },
    { id: 'combo', name: 'Mark + Wordmark', shapeable: true }
  ];
  const LOGO_SHAPES = ['square', 'circle', 'hexagon', 'diamond', 'pill'];

  function randomLogoSpec(project) {
    const pal = DB.getPalette(project.site.palette);
    const seed = (project.site && project.site.fingerprint && project.site.fingerprint.seed)
      || hash((project.site && project.site.name) || 'logo');
    return {
      style: LOGO_STYLES[Math.abs(seed) % LOGO_STYLES.length].id,
      shape: LOGO_SHAPES[Math.abs(seed + 17) % LOGO_SHAPES.length],
      font: project.site.font || 'inter',
      colors: [pal.primary, pal.accent],
      text: project.site.name,
      seed
    };
  }

  // apply a logo to the project (spec optional → random style)
  function logo(project, spec) {
    const s = spec || randomLogoSpec(project);
    const uri = logoPreview(project, s);
    project.site.logo = uri;
    return uri;
  }

  function altText(project) {
    let n = 0;
    project.site.sections.forEach((s) => {
      if (s.image && !s.alt) { s.alt = ((s.title || s.type) + ' — ' + project.site.name); n++; }
      (s.items || []).forEach((it) => {
        if (it.image && !it.alt) { it.alt = ((it.title || it.text || 'image') + ' — ' + project.site.name); n++; }
      });
    });
    return n;
  }

  // ============================================================
  // AI style packs — one-click full-look transformations
  // ============================================================
  const stylePacks = [
    {
      id: 'glass', name: 'Glassmorphism', icon: '🧊', tagline: 'Frosted translucent cards, soft glow, modern depth',
      palette: 'pack_glass', font: 'sora', radius: 24, spacing: 120,
      css: `.sec-hero{background:radial-gradient(1100px 650px at 85% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 60%),radial-gradient(900px 600px at -10% 115%,color-mix(in srgb,var(--primary) 26%,transparent),transparent 55%)}
.card,.faq-item,.cd-cell,.contact-form,.newsletter,.gal-item{border:1px solid color-mix(in srgb,#fff 16%,transparent);background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,.03));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 24px 60px rgba(0,0,0,.35)}
body.theme-light .card,body.theme-light .faq-item,body.theme-light .cd-cell,body.theme-light .contact-form,body.theme-light .newsletter{background:linear-gradient(160deg,rgba(255,255,255,.72),rgba(255,255,255,.45));border-color:color-mix(in srgb,#fff 60%,transparent)}
.feat-icon{border:1px solid color-mix(in srgb,#fff 22%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.25)}
.nav{background:color-mix(in srgb,var(--bg) 52%,transparent);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}`
    },
    {
      id: 'brutal', name: 'Brutalist', icon: '🧱', tagline: 'Raw typography, thick borders, hard offset shadows',
      palette: 'pack_brutal', font: 'bebas', radius: 4, spacing: 100,
      css: `.card,.faq-item,.cd-cell,.newsletter{border:2px solid var(--text);box-shadow:7px 7px 0 var(--text)}
.card:hover,.faq-item:hover{transform:translate(-3px,-3px);box-shadow:10px 10px 0 var(--accent)}
.btn{border-radius:2px}.btn.solid{border:2px solid var(--text);box-shadow:4px 4px 0 var(--text);border-radius:2px}
.sec-hero h1,.sec-head h2{text-transform:uppercase;letter-spacing:.01em}
.eyebrow{border:1px solid var(--text);padding:6px 12px;border-radius:0;display:inline-block}
.nav{border-bottom:2px solid var(--text)}
.feat-icon,.gal-item{border:2px solid var(--text);border-radius:4px}
.hero-badge{border-radius:0}`
    },
    {
      id: 'retro', name: 'Neo Retro', icon: '🌅', tagline: '70s cream & terracotta, playful serif, warm frames',
      palette: 'pack_retro', font: 'dmserif', radius: 12, spacing: 110,
      css: `.card,.faq-item,.cd-cell{border:2px solid color-mix(in srgb,var(--primary) 22%,transparent);box-shadow:10px 10px 0 color-mix(in srgb,var(--accent) 26%,transparent)}
.card:hover{transform:translate(-4px,-4px);box-shadow:14px 14px 0 color-mix(in srgb,var(--accent) 40%,transparent)}
.sec-head h2{font-size:clamp(2rem,4.4vw,3rem)}
.btn.solid{border-radius:999px;box-shadow:0 6px 0 color-mix(in srgb,var(--primary) 45%,transparent)}
.feat-icon{background:var(--accent);color:#fff;border-radius:50%}
.gal-item{border-radius:50% 50% 14px 14px}`
    },
    {
      id: 'editorial', name: 'Editorial', icon: '📰', tagline: 'Magazine layout, ink serif, hairline rules, quiet elegance',
      palette: 'pack_editorial', font: 'playfair', radius: 8, spacing: 110,
      css: `.card,.faq-item,.cd-cell,.newsletter{border-radius:2px;box-shadow:none;border:1px solid #e0dcd2}
.card:hover{transform:translateY(-4px);box-shadow:0 18px 40px rgba(0,0,0,.06)}
.btn{border-radius:2px;letter-spacing:.02em}
.eyebrow::after{content:'';display:block;width:46px;height:3px;background:var(--primary);margin-top:8px}
.sec-head h2{font-size:clamp(2rem,4.2vw,2.9rem)}
.hero-badge{border-radius:2px}
.stat-num{font-size:clamp(2.4rem,5.5vw,3.8rem)}`
    },
    {
      id: 'cosmic', name: 'Cosmic Dusk', icon: '🌌', tagline: 'Deep-space gradient, glowing accents, dreamy shadows',
      palette: 'pack_cosmic', font: 'sora', radius: 20, spacing: 120,
      css: `.sec-hero{background:radial-gradient(1000px 600px at 50% -20%,color-mix(in srgb,var(--primary) 30%,transparent),transparent 65%)}
.sec-hero h1{text-shadow:0 0 70px color-mix(in srgb,var(--accent) 60%,transparent)}
.card,.faq-item,.cd-cell{border:1px solid color-mix(in srgb,var(--primary) 32%,transparent);box-shadow:0 0 44px color-mix(in srgb,var(--primary) 16%,transparent),0 22px 60px rgba(0,0,0,.42)}
.gal-item{border-radius:18px;box-shadow:0 0 30px color-mix(in srgb,var(--accent) 20%,transparent)}
.feat-icon{box-shadow:0 0 26px color-mix(in srgb,var(--primary) 45%,transparent);border-radius:50%}
.newsletter{border:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}`
    },
    {
      id: 'lux', name: 'Luxury Gold', icon: '👑', tagline: 'Champagne on charcoal, serif titles, understated wealth',
      palette: 'pack_lux', font: 'playfair', radius: 18, spacing: 130,
      css: `.card,.faq-item,.cd-cell{border:1px solid color-mix(in srgb,var(--primary) 38%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 78%,var(--primary)) 0%,var(--surface) 100%)}
.eyebrow{letter-spacing:.3em}
.btn.solid{background:linear-gradient(135deg,var(--accent),var(--primary));color:#0d0c11}
.sec-head h2{font-weight:600;letter-spacing:-.01em}
.gal-item{border-radius:8px}
.feat-icon{border:1px solid color-mix(in srgb,var(--primary) 55%,transparent);border-radius:50%}`
    },
    {
      id: 'zen', name: 'Zen Sage', icon: '🍃', tagline: 'Soft greens, quiet spacing, calm rounded minimalism',
      palette: 'pack_zen', font: 'manrope', radius: 16, spacing: 120,
      css: `.card,.faq-item,.cd-cell{box-shadow:0 14px 34px rgba(40,60,40,.08);border:1px solid color-mix(in srgb,var(--primary) 12%,transparent)}
.btn{border-radius:10px}
.sec-head h2{font-weight:600}
.section{padding:120px 0}
.feat-icon{border-radius:30% 70% 70% 30%/30% 30% 70% 70%;background:color-mix(in srgb,var(--primary) 14%,transparent)}`
    },
    {
      id: 'playful', name: 'Playful Pop', icon: '🍭', tagline: 'Bouncy candy colors, chunky buttons, friendly shapes',
      palette: 'candy', font: 'poppins', radius: 26, spacing: 110,
      css: `.btn{border-radius:16px;border-bottom:4px solid rgba(0,0,0,.18)}
.card,.faq-item,.cd-cell{border:2px dashed color-mix(in srgb,var(--accent) 30%,transparent)}
.card:hover{transform:translateY(-8px) rotate(-.6deg)}
.feat-icon{background:var(--grad);color:#fff;border-radius:30% 70% 70% 30%/30% 30% 70% 70%}
.sec-head h2{letter-spacing:-.01em}
.eyebrow{color:var(--accent)}`
    }
  ];

  function packCss(pack) {
    return (pack && pack.css) || '';
  }
  function applyStylePack(project, packId) {
    const pk = stylePacks.find((x) => x.id === packId);
    if (!pk || !project || !project.site) return null;
    const s = project.site;
    s.palette = pk.palette;
    s.font = pk.font;
    s.fontDisplay = ''; // packs define their own full typographic voice
    s.design = s.design || {};
    if (pk.radius != null) s.design.radius = pk.radius;
    if (pk.spacing != null) s.design.spacing = pk.spacing;
    if (pk.heroLayout) s.heroLayout = pk.heroLayout;
    s.design.styleCss = packCss(pk);
    s.stylePack = { id: pk.id, name: pk.name, at: Date.now() };
    return pk;
  }
  function clearStylePack(project) {
    if (!project || !project.site) return;
    delete project.site.stylePack;
    if (project.site.design) delete project.site.design.styleCss;
  }

  // ============================================================
  // Chat copilot — understand a plain-English edit command and
  // return a list of concrete, executable site actions.
  // ops are executed by app.js, which owns rendering/undo/credits.
  // ============================================================
  const norm = (s) => ' ' + String(s).toLowerCase().replace(/[’‘“”]/g, "'").replace(/[^a-z0-9+@.']+/g, ' ').trim() + ' ';

  const SEC_WORDS = [
    ['hero', ['hero', 'headline', 'banner', 'top section']],
    ['about', ['about', 'our story', 'who we are', 'story section']],
    ['features', ['features', 'feature grid', 'services', 'offerings', 'why us']],
    ['stats', ['stats', 'statistics', 'numbers', 'metrics', 'counters']],
    ['pricing', ['pricing', 'price', 'plans', 'tiers', 'cost']],
    ['testimonials', ['testimonials', 'testimonial', 'reviews', 'quotes', 'social proof']],
    ['faq', ['faq', 'frequently asked', 'questions section', 'accordion']],
    ['gallery', ['gallery', 'photos', 'pictures', 'portfolio', 'image grid']],
    ['blog', ['blog', 'posts', 'articles', 'news section']],
    ['shop', ['shop', 'products', 'store', 'catalog']],
    ['logos', ['logo strip', 'logos strip', 'trusted by']],
    ['video', ['video', 'youtube', 'vimeo']],
    ['countdown', ['countdown', 'timer', 'launch date']],
    ['contact', ['contact', 'contact form', 'get in touch', 'reach out']],
    ['cta', ['cta', 'call to action', 'cta banner']],
    ['map', ['map', 'maps', 'directions', 'find us', 'location']],
    ['weather', ['weather', 'forecast', 'climate']],
    ['booking', ['booking', 'book online', 'appointment', 'appointments', 'schedule', 'scheduling', 'calendar', 'reserve', 'reservation']],
    ['embed', ['embed', 'spotify', 'calendly', 'typeform', 'iframe']]
  ];

  // catalog layout variants the copilot understands — “make the features bento”,
  // “terminal hero”, “masonry testimonials” …
  const LAYOUT_WORDS = [
    [['bento grid', 'bento'], 'features', 'bento', 'bento grid'],
    [['editorial numbered', 'numbered rows', 'numbered'], 'features', 'numbered', 'editorial numbered rows'],
    [['code terminal', 'terminal hero', 'terminal style', 'cli hero'], 'hero', 'terminal', 'code terminal hero'],
    [['masonry wall', 'masonry'], 'testimonials', 'masonry', 'masonry wall'],
    [['mosaic wall', 'mosaic'], 'gallery', 'mosaic', 'mosaic wall'],
    [['gradient band', 'stats band', 'band layout'], 'stats', 'band', 'gradient band'],
    [['stacked tiers', 'stacked rows', 'tier rows', 'stacked'], 'pricing', 'stacked', 'stacked tier rows'],
    [['floating chips', 'floating layout'], 'about', 'floating', 'floating chips'],
    [['gradient splash', 'splash layout', 'splash'], 'cta', 'splash', 'gradient splash']
  ];
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // find which section types a message mentions, earliest first
  function mentionedSections(msg) {
    const n = norm(msg);
    const hits = [];
    SEC_WORDS.forEach(([type, words]) => {
      words.forEach((w) => {
        const r = new RegExp('(^| )' + escRe(w) + '( |$)');
        const m = n.match(r);
        if (m && m.index != null) hits.push({ type, at: m.index, word: w });
      });
    });
    const bookingIntent = /\b(booking|appointment|appointments|schedule|scheduling|calendar|reserve|reservation|book online|book an appointment)\b/.test(n);
    if (bookingIntent && !hits.some((hit) => hit.type === 'booking')) {
      const terms = ['booking', 'appointment', 'schedule', 'calendar', 'reserve', 'reservation', 'book online'];
      const at = terms.reduce((best, term) => {
        const found = n.indexOf(' ' + term + ' ');
        return found >= 0 && (best < 0 || found < best) ? found : best;
      }, -1);
      hits.push({ type: 'booking', at: at < 0 ? n.length : at, word: 'booking' });
    }
    hits.sort((a, b) => a.at - b.at || b.word.length - a.word.length);
    // “Calendly booking” should be treated as the dedicated booking block,
    // not as a generic iframe. A plain “embed Calendly” still remains generic.
    return bookingIntent ? hits.filter((hit) => hit.type !== 'embed') : hits;
  }
  const lastSecOfType = (site, type) => {
    for (let i = site.sections.length - 1; i >= 0; i--) if (site.sections[i].type === type) return i;
    return -1;
  };

  // color words -> palette id (palettes are the DB palette list incl. pack + custom)
  const COLOR_WORDS = [
    ['glass frost', 'pack_glass'], ['brutal paper', 'pack_brutal'], ['neo retro', 'pack_retro'],
    ['editorial ink', 'pack_editorial'], ['cosmic dusk', 'pack_cosmic'], ['luxury gold', 'pack_lux'], ['zen sage', 'pack_zen'],
    ['midnight violet', 'midnight'], ['midnight', 'midnight'], ['aurora', 'aurora'], ['sunset', 'sunset'],
    ['emerald', 'emerald'], ['cherry', 'cherry'], ['ocean', 'ocean'], ['noir', 'noir'], ['candy', 'candy'],
    ['navy', 'ocean'], ['indigo', 'midnight'], ['royal blue', 'ocean'], ['dark blue', 'ocean'], ['blue', 'ocean'],
    ['purple', 'midnight'], ['violet', 'midnight'], ['grape', 'midnight'],
    ['cyan', 'aurora'], ['teal', 'ocean'], ['aqua', 'aurora'], ['sky blue', 'aurora'],
    ['green', 'emerald'], ['sage', 'emerald'], ['forest', 'emerald'], ['mint', 'emerald'],
    ['pink', 'candy'], ['magenta', 'candy'], ['rose', 'candy'], ['fuchsia', 'candy'],
    ['red', 'cherry'], ['crimson', 'cherry'], ['warm', 'sunset'], ['orange', 'sunset'], ['amber', 'sunset'], ['peach', 'sunset'],
    ['gold', 'pack_lux'], ['champagne', 'pack_lux'],
    ['black', 'noir'], ['monochrome', 'noir'], ['mono', 'noir'], ['grayscale', 'noir'],
    ['dark', 'midnight'], ['charcoal', 'noir'],
    ['cream', 'pack_retro'], ['beige', 'pack_editorial'], ['paper', 'pack_editorial'], ['soft green', 'pack_zen'], ['sage green', 'pack_zen']
  ];

  function matchPalette(msg) {
    const n = norm(msg);
    // exact palette-name mentions first
    for (const [word, id] of COLOR_WORDS) {
      if (n.indexOf(' ' + word + ' ') !== -1) return id;
    }
    // no exact color intent unless the message is asking for a color change
    return null;
  }
  function matchFont(msg) {
    const n = norm(msg);
    const table = [
      ['jetbrains mono', 'jetbrains'], ['jetbrains', 'jetbrains'],
      ['space grotesk', 'spacegrotesk'], ['grotesk', 'spacegrotesk'],
      ['playfair', 'playfair'], ['dm serif', 'dmserif'], ['pacifico', 'pacifico'], ['poppins', 'poppins'],
      ['montserrat', 'montserrat'], ['manrope', 'manrope'], ['outfit', 'outfit'], ['sora', 'sora'], ['inter', 'inter'], ['bebas', 'bebas'],
      ['monospace', 'jetbrains'], ['mono', 'jetbrains'], ['code font', 'jetbrains'],
      ['script', 'pacifico'], ['cursive', 'pacifico'], ['handwritten', 'pacifico'],
      ['condensed', 'bebas'], ['impact font', 'bebas'],
      ['serif', 'playfair'], ['elegant serif', 'playfair'], ['classic', 'playfair'],
      ['plus jakarta', 'plusjakarta'], ['dm sans', 'dmsans'], ['figtree', 'figtree'], ['work sans', 'worksans'], ['lexend', 'lexend'], ['raleway', 'raleway'],
      ['lora', 'lora'], ['source serif', 'sourceserif'], ['merriweather', 'merriweather'],
      ['oswald', 'oswald'], ['syne', 'syne'], ['unbounded', 'unbounded'], ['anton', 'anton'],
      ['archivo black', 'archivoblack'], ['righteous', 'righteous'], ['alfa slab', 'alfaslab'], ['slab serif', 'alfaslab'],
      ['fraunces', 'fraunces'], ['bodoni', 'bodoni'], ['cormorant', 'cormorant'], ['garamond', 'cormorant'],
      ['caveat', 'caveat'], ['dancing script', 'dancingscript'], ['great vibes', 'greatvibes'],
      ['fira code', 'firacode'], ['space mono', 'spacemono'],
      ['sans serif', 'inter'], ['clean sans', 'inter'], ['geometric', 'poppins'], ['rounded', 'poppins'],
      ['futuristic', 'spacegrotesk'], ['techy', 'spacegrotesk']
    ];
    for (const [word, id] of table) if (n.indexOf(' ' + word + ' ') !== -1) return id;
    return null;
  }
  function matchStylePack(msg) {
    const n = norm(msg);
    const table = [
      ['glassmorphism', 'glass'], ['glass', 'glass'], ['frosted', 'glass'],
      ['brutalist', 'brutal'], ['brutalism', 'brutal'], ['brutal', 'brutal'],
      ['neo retro', 'retro'], ['neoretro', 'retro'], ['70s', 'retro'], ['70 s', 'retro'], ['vintage', 'retro'],
      ['editorial', 'editorial'], ['magazine', 'editorial'], ['newspaper', 'editorial'],
      ['cosmic', 'cosmic'], ['galaxy', 'cosmic'], ['space theme', 'cosmic'], ['starry', 'cosmic'], ['nebula', 'cosmic'],
      ['luxury', 'lux'], ['luxe', 'lux'], ['gold theme', 'lux'], ['premium elegant', 'lux'],
      ['zen', 'zen'], ['sage', 'zen'], ['calm minimal', 'zen'], ['spa feel', 'zen'], ['zen sage', 'zen'],
      ['playful', 'playful'], ['pop style', 'playful'], ['colorful fun', 'playful'], ['kawaii', 'playful'], ['bouncy', 'playful']
    ];
    for (const [word, id] of table) if (n.indexOf(' ' + word + ' ') !== -1) return id;
    return null;
  }

  // tone directions for AI rewrites
  const TONES = ['punchy', 'punchier', 'exciting', 'more exciting', 'engaging', 'friendlier', 'friendly', 'professional', 'more professional',
    'warmer', 'warm', 'luxurious', 'elegant', 'fun', 'funny', 'playful', 'concise', 'shorter', 'snappier', 'confident', 'bold',
    'emotional', 'convincing', 'persuasive', 'better', 'improve', 'rewrite', 'improved', 'stronger', 'catchier', 'crisper', 'refined'];

  const SUGGEST = [
    '🧊 Make it glassmorphism',
    '✨ Make the hero punchier',
    '🧩 Make the features bento',
    '💻 Give the hero a code terminal look',
    '🗺️ Add a map of London',
    '🎨 Build me a brand kit',
    '◆ Generate an AI logo',
    '📰 Give it an editorial look'
  ];

  const chatHelp = 'I can restyle the whole site (“make it glassmorphism” or “luxury gold”), retune design (“rounder corners”, “more spacing”), apply catalog layouts (“make the features bento”, “terminal hero”, “masonry testimonials”), tweak copy (“make the hero punchier”), change colors, fonts, buttons and nav, and add or remove sections — “add a pricing section”, “add a map of Paris”, “weather in London”, “add an online booking block”, “delete the FAQ”, “swap the order”… I can even change your site name, phone, email or CTA, or build a full brand kit with one command. Every change is undoable (' + KBD + 'Z), and AI copy rewrites use one credit.';

  function chatPlan(site, msg, ctx) {
    const raw = String(msg || '').trim();
    if (!raw) return { acts: [], reply: 'Say what you\'d like to change — for example “make it glassmorphism” or “rounder corners”.' };
    const n = norm(raw);
    const acts = [];
    const isAsking = (/^(hi|hey|hello|yo)\b/.test(n.trim()) && raw.length < 30) ||
      /what can you do|help me|who are you|how does this work|what should i say|give me an example/.test(n);
    const askingOnly = isAsking && !mentionedSections(raw).length && !TONES.some((t) => n.indexOf(' ' + t + ' ') !== -1) && !/\b(add|remove|make|change|switch|set|rewrite|color|palette|font)\b/.test(n);
    if (askingOnly) return { acts: [], reply: chatHelp };

    const FU = followLib();
    const followId = FU && FU.isFollowUp(raw);
    if (followId) {
      const target = ctx && ctx.targetType;
      if (!target) return { acts: [], reply: 'Nothing to tweak yet — edit a section first, then say shorter, more local, or less salesy.' };
      const idx = lastSecOfType(site, target);
      if (idx < 0) return { acts: [], reply: 'Nothing to tweak yet — edit a section first, then say shorter, more local, or less salesy.' };
      return { acts: [{ op: 'rewriteSection', type: target, idx, mode: followId, prompt: raw, credit: true, label: 'Rewrote the ' + target + ' section' }] };
    }
    if (/\bmore like\b|\bsimilar to\b|\blike https?:\/\//i.test(raw)) {
      const url = FU && FU.likeUrl(raw);
      if (url) return { acts: [{ op: 'likeUrl', url, credit: false, label: 'Restyled from the reference site (layout only)' }] };
    }
    if (/\badd a menu\b/i.test(raw) || (/\badd\b/i.test(raw) && /\bmenu\b/i.test(raw) && /\b(wine|pub|brewery|bar)\b/i.test(raw))) {
      const niche = matchNiche(raw);
      if (niche) return { acts: [{ op: 'nicheExtras', nicheId: niche.id, credit: false, label: 'Added ' + niche.name + ' extras' }] };
    }
    if (/\badd a services page\b/.test(n) || (/\bservices page\b/.test(n) && /\badd\b/.test(n))) {
      return { acts: [{ op: 'servicesPage', credit: false, label: 'Added a Services page from your features' }] };
    }
    if (/\bfix the weak cta\b/.test(n)) {
      const next = (site && site.brief && site.brief.cta) || 'Book now';
      return { acts: [{ op: 'setField', key: 'ctaText', value: next, credit: true, label: 'Strengthened the primary CTA' }] };
    }
    if (/\bbrand kit\b|\bbrand package\b|\blogo and (colors|colours|palette)\b|\bnew logo\b/.test(n)) {
      acts.push({ op: 'brandKit', credit: true, label: 'Built you a brand kit — logo, palette, fonts and alt text' });
    }

    // ---- catalog layout variants ----
    for (const [words, lType, lLayout, lName] of LAYOUT_WORDS) {
      if (words.some((w) => n.indexOf(' ' + w + ' ') !== -1)) {
        acts.push({ op: 'layout', type: lType, layout: lLayout, label: 'Applied the ' + lName + ' layout to the ' + lType + ' section' });
        break;
      }
    }

    // ---- whole-message convenience actions (first match wins) ----
    if (matchStylePack(raw)) {
      const id = matchStylePack(raw);
      const pk = stylePacks.find((x) => x.id === id);
      acts.push({ op: 'pack', pack: id, label: 'Applied the ' + pk.name + ' look (' + pk.tagline + ')' });
      return { acts };
    }
    if (/\b(undo|revert that|take that back)\b/.test(n)) {
      acts.push({ op: 'undo', label: 'Undid the last change' });
      return { acts };
    }
    if (/\b(stop|close|hide|dismiss)\b/.test(n) && /\b(chat|copilot|panel|this)\b/.test(n)) {
      acts.push({ op: 'closeChat', label: '' });
      return { acts };
    }
    const wantColor = /\b(color|colour|palette|shade|tone)\b/.test(n) || /\b(make|change|switch|try|use|give|paint|turn|go|set)\b/.test(n);
    const colorId = matchPalette(raw);
    if (colorId && wantColor && !/\b(mode|toggle|theme button)\b/.test(n)) {
      const pal = DB.getPalette(colorId);
      acts.push({ op: 'palette', palette: colorId, label: 'Switched the color palette to ' + pal.name });
    }
    const fontId = matchFont(raw);
    if (fontId && /\b(font|typeface|typography|lettering|serif|sans|script|mono|condensed)\b/.test(n)) {
      const f = DB.getFont(fontId);
      acts.push({ op: 'font', font: fontId, label: 'Set the font to ' + f.name });
    }
    const haveActs = acts.length;

    // ---- design tokens ----
    if (/\b(rounder|rounded|softer|more rounded|less rounded|sharper|square|sharp|boxy)\b/.test(n)) {
      const up = /\b(rounder|rounded|softer|more rounded)\b/.test(n);
      acts.push({ op: 'design', key: 'radius', delta: up ? 10 : -999, min: 0, label: up ? 'Rounder corners (radius +10)' : 'Sharpened corners (radius 0)' });
    } else {
      const rm = n.match(/\bradius\b[^0-9]{0,8}(\d{1,2})\b/);
      if (rm) acts.push({ op: 'design', key: 'radius', to: +rm[1], label: 'Corner radius set to ' + rm[1] + 'px' });
    }
    if (/\b(spacious|roomier|roomy|more space|breathing room|airy)\b/.test(n)) {
      acts.push({ op: 'design', key: 'spacing', delta: 24, label: 'More space between sections (+24px)' });
    } else if (/\b(compact|tighter|less space|cozier|smaller gaps)\b/.test(n)) {
      acts.push({ op: 'design', key: 'spacing', delta: -24, min: 40, label: 'Tighter layout (−24px spacing)' });
    } else {
      const sm = n.match(/\bspacing\b[^0-9]{0,8}(\d{2,3})\b/);
      if (sm) acts.push({ op: 'design', key: 'spacing', to: +sm[1], label: 'Section spacing set to ' + sm[1] + 'px' });
    }
    const wm = n.match(/\b(container )?width\b[^0-9]{0,8}(\d{3,4})\b/);
    if (wm) acts.push({ op: 'design', key: 'containerWidth', to: +wm[2], label: 'Container width set to ' + wm[2] + 'px' });

    // ---- hero layout ----
    const secMentions = mentionedSections(raw);
    const hasHero = secMentions.some((h) => h.type === 'hero');
    if (/\b(split|two column|two column|side by side|text and image)\b/.test(n) && hasHero) {
      acts.push({ op: 'hero', layout: 'split', label: 'Hero switched to a split text + image layout' });
    } else if (/\b(minimal|clean hero|simple hero)\b/.test(n) && hasHero) {
      acts.push({ op: 'hero', layout: 'minimal', label: 'Hero switched to the minimal layout' });
    } else if (/\b(centered|center the hero|centre)\b/.test(n) && hasHero) {
      acts.push({ op: 'hero', layout: 'centered', label: 'Hero centered' });
    }

    // ---- nav ----
    if (/\b(nav|menu|navigation|header)\b/.test(n)) {
      if (/\b(transparent|overlay|floating)\b/.test(n)) acts.push({ op: 'navStyle', style: 'transparent', label: 'Nav is now transparent over the hero' });
      else if (/\b(solid|opaque|normal nav|not transparent)\b/.test(n)) acts.push({ op: 'navStyle', style: '', label: 'Nav is back to a solid frosted bar' });
      if (/\b(unsticky|not sticky|stop sticking)\b/.test(n)) acts.push({ op: 'navSticky', on: false, label: 'Nav no longer sticks to the top' });
      else if (/\b(sticky|sticks|fixed at top)\b/.test(n)) acts.push({ op: 'navSticky', on: true, label: 'Nav is now sticky' });
      const hasNavBtn = /\b(button|cta|book now|book a|get a quote|call us|contact us|nav button)\b/.test(n);
      if (hasNavBtn) {
        if (/\b(remove|drop|delete|hide)\b/.test(n) && /\b(button|cta)\b/.test(n)) {
          acts.push({ op: 'navCta', text: '', label: 'Removed the nav CTA button' });
        } else {
          let t = '';
          const nq = raw.match(/(?:says?|reads?|label|text)\s*[:=]?\s*["']([^"']{2,34})["']/i);
          if (nq) t = nq[1];
          else {
            const np = raw.match(/(?:says?|reads?)\s+([A-Z][A-Za-z0-9&.,!' ]{2,26})/);
            if (np) t = np[1].trim();
          }
          if (t && !/^(button|cta|say|to|text)$/i.test(t)) {
            acts.push({ op: 'navCta', text: t, label: 'Nav CTA button now reads “' + t + '”' });
          } else {
            const def = /\b(book|book now|book a)\b/.test(n) ? 'Book now' : /\b(quote)\b/.test(n) ? 'Get a quote' : 'Contact us';
            acts.push({ op: 'navCta', text: def, label: 'Added a “' + def + '” button to the nav' });
          }
        }
      }
    }
    if (/\b(dark mode|theme toggle|dark mode button|light mode toggle)\b/.test(n)) {
      if (/\b(remove|delete|hide|turn off|disable)\b/.test(n)) acts.push({ op: 'themeToggle', on: false, label: 'Removed the visitor theme toggle' });
      else acts.push({ op: 'themeToggle', on: true, label: 'Visitors now get a dark/light toggle' });
    }

    // ---- site fields (name / tagline / email / phone …) ----
    const q = raw.match(/("([^"]+)"|'([^']+)')/);
    const quoted = q ? (q[2] || q[3]) : null;
    if (/\b(call it|call the (site|business|company|studio)|name it|rename|rename it|brand it)\b/.test(n)) {
      const cap = quoted || (raw.match(/\b(?:call|name|rename)\s+(?:it|the\s+(?:site|business|company|studio))?\s*\b([A-Za-z0-9&.' ]{2,40})/) || [])[1];
      if (cap) acts.push({ op: 'setField', key: 'name', value: cap.replace(/\.$/, '').trim(), label: 'Site name is now “' + cap.replace(/\.$/, '').trim() + '”' });
    } else if (/\btagline\b/.test(n)) {
      if (quoted) acts.push({ op: 'setField', key: 'tagline', value: quoted, label: 'Tagline updated ✓' });
    }
    const em = raw.match(/\b(?:email|e-mail|mail)(?:\s+(?:is|at))?\s*[:@]?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i) ||
      (raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) && /\b(?:email|contact|mail)\b/i.test(n) ? [null, raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)[0]] : null);
    if (em) acts.push({ op: 'setField', key: 'email', value: em[1], label: 'Contact email set to ' + em[1] });
    const phStart = raw.search(/phone|call me|whatsapp/i);
    if (phStart !== -1 && !/\b(phone section|no phone)\b/.test(n)) {
      const pm = raw.slice(phStart).match(/[+]?[0-9][0-9\s().-]{6,20}/);
      if (pm) acts.push({ op: 'setField', key: 'phone', value: pm[0].trim(), label: 'Phone set to ' + pm[0].trim() });
    }
    const ad = raw.match(/\baddress\b[^a-z0-9]{0,12}([A-Za-z0-9.,' -]{8,60})/i);
    if (ad) acts.push({ op: 'setField', key: 'address', value: ad[1].trim(), label: 'Address updated ✓' });
    if (/\b(description|meta description|seo blurb)\b/.test(n) && quoted) acts.push({ op: 'setField', key: 'description', value: quoted, label: 'Site description updated ✓' });
    if (/\b(favicon|tab icon)\b/.test(n) && quoted) acts.push({ op: 'setField', key: 'favicon', value: quoted, label: 'Favicon set to ' + quoted });

    // ---- CTA text / link ----
    const hasBtnCtx = /\b(button|cta|button say|button text|button label)\b/.test(n) && !/\bnav\b/.test(n);
    if (hasBtnCtx) {
      let t = '';
      const bq = raw.match(/(?:says?|reads?|label|text)\s*[:=]?\s*["']([^"']{2,34})["']/i);
      if (bq) t = bq[1];
      else {
        const bp = raw.match(/(?:says?|reads?|to)\s+([A-Z][A-Za-z0-9&.,!' ]{2,26})/);
        if (bp) t = bp[1].trim();
      }
      if (t && !/^(button|cta|say|to|text)$/i.test(t)) acts.push({ op: 'setField', key: 'ctaText', value: t, label: 'Main button now reads “' + t + '”' });
    }
    if (/\b(logo)\b/.test(n) && /\b(generate|make|create|new|ai)\b/.test(n) && !/\b(remove|delete)\b/.test(n)) {
      acts.push({ op: 'logo', label: 'AI logo generated for the brand' });
    }
    if (/\b(alt text|image descriptions|describe images)\b/.test(n)) acts.push({ op: 'alt', label: 'Alt text filled in for every image' });
    if (/\b(generate (ai )?images|ai images|add photos|stock photos|generate pictures)\b/.test(n)) {
      acts.push({ op: 'images', credit: true, label: 'AI images generated for hero / about / gallery' });
    }

    // ---- suites ----
    const suiteMap = [['blog', 'blog'], ['shop', 'shop'], ['gallery pro', 'gallerypro'], ['seo', 'seo'], ['animation pack', 'animation'], ['contact pro', 'contactpro']];
    if (/\b(install|add|get|enable|turn on|activate)\b/.test(n)) {
      for (const [word, id] of suiteMap) if (n.indexOf(' ' + word + ' ') !== -1) { acts.push({ op: 'suite', suite: id, label: 'Installed the ' + DB.getSuite(id).name }); break; }
    }
    if (/\b(uninstall|remove|disable|turn off)\b/.test(n)) {
      for (const [word, id] of suiteMap) if (n.indexOf(' ' + word + ' ') !== -1) { acts.push({ op: 'unsuite', suite: id, label: 'Removed the ' + DB.getSuite(id).name }); break; }
    }

    // ---- copy rewrites (cost a credit) ----
    const tone = TONES.find((t) => n.indexOf(' ' + t + ' ') !== -1);
    const rewriteAll = !secMentions.length && (/\b(rewrite|improve|polish|enhance|refine)\b/.test(n) || (tone && /\b(copy|text|site|whole)\b/.test(n)));
    const sectionTarget = secMentions.length ? secMentions[0] : null;
    if ((rewriteAll || (secMentions.length && (tone || /\b(rewrite|copy|text|write|say)\b/.test(n))))) {
      if (sectionTarget && ['features', 'stats', 'pricing', 'testimonials', 'faq', 'blog', 'shop', 'gallery', 'logos'].includes(sectionTarget.type)) {
        const idx = lastSecOfType(site, sectionTarget.type);
        if (idx === -1 && /\b(add|create|new)\b/.test(n)) acts.push({ op: 'addSection', type: sectionTarget.type, label: 'Added a ' + (DB.sectionTypes[sectionTarget.type] || {}).name + ' section' });
        else if (idx >= 0) acts.push({ op: 'rewriteItems', type: sectionTarget.type, idx, credit: true, label: 'Refreshed the ' + sectionTarget.type + ' content with AI' });
        else if (rewriteAll) acts.push({ op: 'rewriteAll', label: 'Whole-site copy enhanced' });
      } else if (sectionTarget) {
        const idx = lastSecOfType(site, sectionTarget.type);
        if (idx === -1 && /\b(add|create|new)\b/.test(n)) acts.push({ op: 'addSection', type: sectionTarget.type, label: 'Added a ' + (DB.sectionTypes[sectionTarget.type] || {}).name + ' section' });
        else if (idx >= 0) acts.push({ op: 'rewrite', idx, prompt: raw, credit: true, label: 'Rewrote the ' + sectionTarget.type + ' section copy' });
      } else if (rewriteAll) acts.push({ op: 'rewriteAll', credit: true, label: 'Whole-site copy enhanced with AI' });
    }

    // ---- add / remove / reorder sections ----
    const hasSuite = /\bsuite\b/.test(n);
    if (!hasSuite && !acts.some((a) => a.op === 'suite' || a.op === 'unsuite')) {
      const mentions = mentionedSections(raw);
      const bookingIntent = /\b(booking|appointment|appointments|schedule|scheduling|calendar|reserve|reservation|book online|book an appointment)\b/.test(n);
      const t = bookingIntent ? (mentions.find((hit) => hit.type === 'booking') || { type: 'booking', word: 'booking' }) : mentions[0];
      const strictVerb = /\b(add|create|insert|include)\b/.test(n) || (t && t.type === 'embed' && /\b(embed|spotify|calendly|typeform|iframe)\b/.test(n));
      const softVerb = (/\b(new|need|another)\b/.test(n)) && /\bsection\b/.test(n);
      if (t && (strictVerb || softVerb) && !acts.some((a) => a.op === 'addSection')) {
        let extra = '';
        if (t.type === 'map') {
          const mm = raw.match(/\bmap\s+of\s+([A-Za-z0-9.,' -]{2,40})/i);
          if (mm) extra = mm[1].trim();
        } else if (t.type === 'weather') {
          const wm = raw.match(/\bweather\s+in\s+([A-Za-z0-9.,' -]{2,40})/i);
          if (wm) extra = wm[1].trim();
        } else if (t.type === 'embed' || t.type === 'booking') {
          const um = raw.match(/https?:\/\/[^\s"']{6,120}/i);
          if (um) extra = um[0].trim();
        }
        const bookingProvider = t.type === 'booking'
          ? (/tidycal/i.test(raw) ? 'tidycal' : /\bcal\.com\b/i.test(raw) ? 'calcom' : /calendly/i.test(raw) ? 'calendly' : /youcanbookme/i.test(raw) ? 'youcanbookme' : /square/i.test(raw) ? 'square' : 'custom')
          : '';
        acts.push({ op: 'addSection', type: t.type, extra, bookingUrl: t.type === 'booking' ? extra : '', bookingProvider, label: 'Added a ' + (DB.sectionTypes[t.type] || {}).name + ' section' + (extra ? ' (' + extra.slice(0, 24) + ')' : '') });
      }
      if (/\b(remove|delete|drop|take out|get rid of)\b/.test(n) && t && !acts.some((a) => a.op === 'removeSection')) {
        acts.push({ op: 'removeSection', type: t.type, label: 'Removed the ' + t.word + ' section' });
      }
    }
    if (/\b(duplicate|copy|repeat)\b/.test(n)) {
      const t = mentionedSections(raw)[0];
      if (t) acts.push({ op: 'duplicateSection', type: t.type, label: 'Duplicated the ' + t.word + ' section' });
    }
    const moveM = raw.match(/\b(move|swap|put|bring)\b.*\b(above|below|before|after|up|down|to the top|to the bottom)\b/);
    if (moveM && secMentions.length >= 2) {
      acts.push({ op: 'moveSection', a: secMentions[0].type, b: secMentions[1].type, rel: /\b(above|before|up)\b/.test(n) ? 'above' : 'below', label: 'Moved the sections around' });
    } else if (moveM && secMentions.length === 1) {
      const t = secMentions[0].type;
      acts.push({ op: 'moveSection', a: t, rel: /\b(above|before|up|top)\b/.test(n) ? 'top' : 'bottom', label: 'Moved the ' + t + ' section' });
    }

    // ---- greeting-free fallback ----
    if (!acts.length && haveActs === 0) {
      // nothing understood — but offer the closest helpers
      acts.push({ op: 'help', label: '' });
    }
    return { acts };
  }

  // Sample content bank for sections added through the copilot chat.
  function sampleSection(type, project) {
    const s = (project && project.site) || {};
    const brand = s.name || '';
    const raw = brand + ' ' + (s.tagline || '');
    const t = TYPES.find((x) => x.id === (project && project.aiType)) || detectType(raw || brand || 'business');
    const focus = focusPhrase(raw);
    const fillS = (str) => String(str || '').replace(/\{brand\}/g, brand).replace(/\{focus\}/g, focus);
    const post = (title, text, extra) => ({ title, text, extra, icon: 'Post' });
    let preset = {};
    switch (type) {
      case 'about':
        preset = { title: t.aboutTitle || 'Our story', text: fillS(t.about), items: [
          { icon: '✓', title: 'Experienced, certified team' }, { icon: '✓', title: 'Transparent, honest pricing' }, { icon: '✓', title: 'Support that actually answers' }
        ] };
        break;
      case 'features':
        preset = { title: 'Why ' + brand || 'Why choose us', subtitle: 'The things our clients mention first.', items: t.features.map((it) => ({ ...it })) }; break;
      case 'stats':
        preset = { title: 'By the numbers', items: t.stats.map((it) => ({ ...it })) }; break;
      case 'testimonials':
        preset = { title: 'Kind words', subtitle: 'What clients and customers say.', items: t.testis.map((it) => ({ ...it })) }; break;
      case 'pricing':
        preset = { title: 'Simple, honest pricing', subtitle: 'No surprises, no hidden fees.', items: t.pricing.map((it) => ({ ...it })) }; break;
      case 'faq':
        preset = { title: 'Questions, answered', items: t.faqs.map((it) => ({ ...it })) }; break;
      case 'gallery':
        preset = { title: 'A glimpse', subtitle: 'Recent moments from our world.', items: (t.gallery || ['Work one', 'Work two', 'Work three', 'Work four']).map((c, i) => ({ text: c, extra: 'Featured ' + (i + 1) })) }; break;
      case 'logos':
        preset = { title: 'Trusted by', items: ['Nortide', 'Draftline', 'Studio Kala', 'Solace', 'Terra', 'Kite'].map((nm) => ({ text: nm })) }; break;
      case 'cta':
        preset = { title: fillS(t.cta.title), text: t.cta.text }; break;
      case 'blog':
        preset = { title: 'Latest from the blog', items: [
          post('Welcome to our new home on the web', 'This is the start of something we have been building towards for a long time — a place to share honest stories from inside ' + brand + '.', 'News · 3 min read'),
          post('Five lessons we learned this year', 'A candid look at the wins, the misses and everything we\'d do again in a heartbeat.', 'Inside ' + brand + ' · 6 min read'),
          post('Why we do things the way we do', 'Our process explained: the small daily habits that add up to work we\'re proud of.', 'Craft · 4 min read')
        ] }; break;
      case 'video':
        preset = { title: 'Watch our story', subtitle: 'A short film about what we do and why.' }; break;
      case 'countdown':
        preset = { title: 'Something great is coming', subtitle: 'We\'re putting the finishing touches on a brand-new chapter.', extra: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }; break;
      case 'map':
        preset = { title: 'Find us', subtitle: 'Come say hello — we\'d love to meet you.' }; break;
      case 'weather':
        preset = { title: 'Weather today', subtitle: 'Live 5-day forecast for your visit.' }; break;
      case 'embed':
        preset = { title: 'Something worth hearing', subtitle: 'A moment from our world.' }; break;
      case 'booking':
        preset = { title: 'Book online', subtitle: 'Choose a time that works for you.', text: 'Schedule your appointment in a few clicks.', bookingProvider: 'calendly', bookingButton: 'Book an appointment' }; break;
      case 'hero':
        preset = { title: '', subtitle: fillS(t.taglines[0]) }; break;
      case 'contact':
        preset = { title: 'Say hello', subtitle: 'We reply within one business day.' }; break;
      default:
        preset = {};
    }
    return DB.newSection(type, preset);
  }

  // credits consumed per action
  const COST = { site: 1, images: 1, enhance: 1, restyle: 1, shuffle: 1, section: 1, translate: 1 };

  return { generateSite, generateDirections, remixDirection, qualityGate, repairQuality, generateImages, studySite, isPublicFetchUrl, enhanceCopy, imageUrl, loadImage, detectType, brandName, focusPhrase, restyle, shuffleLook, enhanceSection, logo, logoPreview, randomLogoSpec, altText, COST, stylePacks, applyStylePack, clearStylePack, chatPlan, chatHelp, sampleSection, imageBase, photoPicks, LOGO_STYLES, LOGO_SHAPES, LOGO_DUOTONES, STYLE_GLYPHS, DIRECTION_PROFILES, applyNicheExtras, addServicesPage, matchNiche };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AI;