'use strict';

function feat(icon, title, text) { return { icon, title, text, extra: '', tag: '', image: '' }; }
function faq(title, text) { return { title, text }; }
function quote(title, text, extra) { return { title, text, extra }; }
function price(icon, title, text, extra, tag) { return { icon, title, text, extra, tag: tag || '' }; }

function pack(id, name, type, k, focus, hero, about, gallery, body) {
  return Object.assign({
    id, name, type, k, focus,
    scenes: { hero, about, gallery }
  }, body);
}

const AiNichesExtra = [
  pack('plumber', 'Emergency Plumber', 'home',
    ['emergency plumber', 'plumber', 'plumbing', 'blocked drain', 'boiler repair', 'leaking tap'],
    'plumbing', 'plumber fixing kitchen sink', 'van of a plumber', 'bathroom plumbing', {
      t: [
        '{brand} — 60-minute emergency call-outs, Gas Safe, and a price you hear before we open a toolbox.',
        'A leak at 11pm should not be a lottery. {brand} answers.',
        'Honest plumbing for {brand} — no scare quotes, no mystery extras.'
      ],
      about: '{brand} is a Gas Safe, fully insured plumbing team that quotes before we work. We keep parts on the van so most jobs finish on the first visit, and our out-of-hours line is a real person, not a call centre.',
      aboutTitle: 'On the van, not on hold',
      feat: [feat('🔧', '60-Minute Call-Out', 'Emergency cover with a real arrival window, not “sometime today”.'), feat('💷', 'Quote Before We Work', 'You hear the number before a tool comes out.'), feat('✅', 'Gas Safe & Insured', 'Boilers, cylinders and gas work done properly.'), feat('🚐', 'Parts on the Van', 'Most first visits finish the job.')],
      stats: [{ title: 'Call-out', text: '60 min' }, { title: 'First-visit fix', text: '87%' }, { title: 'Rated', text: '4.9★' }, { title: 'Years', text: '12' }],
      faqs: [faq('Do you charge for the quote?', 'Call-out is a flat fee, quoted on the phone. The repair is extra and agreed before we start.'), faq('Are you Gas Safe?', 'Yes — ask to see the ID. Boiler work is never unregistered.'), faq('Can you come tonight?', 'Evenings and weekends are covered. Tell us it is an emergency when you call.'), faq('Do you work with landlords?', 'Yes — CP12s, reactive repairs and a simple monthly cover.')],
      testis: [quote('Helen Ward', 'Burst pipe at 10pm. They were here, quoted, and had it stopped in forty minutes.', 'Emergency'), quote('Tom Ellis', 'No scare tactics. He showed me the part and the price. That is rare.', 'Boiler'), quote('Priya Shah', 'Landlord cover is boring in the best way. Certificates arrive the same day.', 'Lettings')],
      price: [price('🚨', 'Emergency', 'from £95', 'Call-out, first hour', 'Popular'), price('🔥', 'Boiler service', '£89', 'Gas Safe annual', ''), price('🏠', 'Landlord pack', '£140', 'CP12 + smoke + CO', '')],
      cta: { title: 'Stop the leak. Then we talk.', text: 'Call now — a real plumber, a real window, a real price.' },
      gal: ['Kitchen leak stopped', 'Boiler service', 'Van stocked', 'New tap fitted', 'Cylinder swap', 'Happy kitchen']
    }),
  pack('electrician', 'Electrician', 'home',
    ['electrician', 'electrical', 'fuse board', 'consumer unit', 'rewire', 'eicr', 'ev charger'],
    'electrical work', 'electrician at a fuse board', 'electrical van', 'new lighting install', {
      t: ['{brand} — NICEIC electricians, tidy first-fix, and certificates that lenders actually accept.', 'Lights, boards and EV chargers done once. {brand}.', 'Safe, tested, photographed. {brand} electrical.'],
      about: '{brand} is an NICEIC-registered electrician team. We photograph every board we touch, issue EICRs that letting agents accept, and will not leave a job without testing and a written schedule.',
      aboutTitle: 'Tested, not guessed',
      feat: [feat('⚡', 'NICEIC', 'Registered, insured, Part P where it matters.'), feat('📋', 'EICR in 48h', 'Landlord certificates without the chase.'), feat('🚗', 'EV chargers', 'Home chargers with OZEV-ready paperwork.'), feat('💡', 'Tidy lighting', 'First-fix that plasterers do not hate.')],
      stats: [{ title: 'EICRs / mo', text: '40+' }, { title: 'Rated', text: '4.8★' }, { title: 'Call-out', text: 'Same day' }, { title: 'Insured', text: '£2m' }],
      faqs: [faq('Are you Part P?', 'Yes — notifiable work is notified. Ask for the building-control reference.'), faq('Can you add sockets without a rewire?', 'Often. We survey first and will say if the circuit cannot take it.'), faq('Do you fit EV chargers?', 'Yes, including the grant paperwork where it still applies.'), faq('Will you work with my builder?', 'We first-fix and second-fix to a programme. Send the drawings.')],
      testis: [quote('Mark Reid', 'Board swap in a live house. Power back before the kids got home.', 'Consumer unit'), quote('Aisha Khan', 'EICR for a sale. Lender happy, no drama.', 'Conveyancing'), quote('Jon Blake', 'EV charger on a tight driveway. Neat, labelled, explained.', 'Home charge')],
      price: [price('🔌', 'Call-out', 'from £85', 'First hour', ''), price('📦', 'Consumer unit', 'from £650', 'Metal board, tested', 'Popular'), price('🚗', 'EV charger', 'from £799', 'Supply and fit', '')],
      cta: { title: 'Book a survey, not a surprise', text: 'Send a photo of the board — we will tell you if it is a job or a conversation.' },
      gal: ['New consumer unit', 'EV charger', 'Downlights', 'Testing kit', 'Labelling', 'Finished kitchen lights']
    }),
  pack('solicitor', 'Solicitor', 'generic',
    ['solicitor', 'solicitors', 'law firm', 'conveyancing', 'wills', 'family law', 'legal'],
    'legal advice', 'solicitor meeting clients', 'law office interior', 'legal documents desk', {
      t: ['{brand} — clear advice, fixed fees where we can, and a lawyer who picks up the phone.', 'Law without the fog. {brand}.', 'Conveyancing, wills and disputes handled like a grown-up. {brand}.'],
      about: '{brand} is a regulated solicitors’ practice. We explain the next step in plain English, give a realistic timeline, and keep a named solicitor on your file so you are not passed around a call centre.',
      aboutTitle: 'A named solicitor, not a ticket',
      feat: [feat('⚖️', 'SRA regulated', 'Properly insured, properly supervised.'), feat('💷', 'Fixed fees where we can', 'Conveyancing and wills quoted up front.'), feat('📞', 'You can ring us', 'A person who knows the file.'), feat('📁', 'Portal updates', 'See where the matter actually is.')],
      stats: [{ title: 'Matters / yr', text: '800+' }, { title: 'Rated', text: '4.7★' }, { title: 'Response', text: '<4h' }, { title: 'Years', text: '18' }],
      faqs: [faq('Do you do legal aid?', 'No — we are a private-client firm. We will say so on the first call.'), faq('Can you quote conveyancing now?', 'Yes, from the tenure and postcode. Extras are listed, not hidden.'), faq('Will I meet the same solicitor?', 'Yes. Cover exists for leave, but the file has a name.'), faq('Do you do court work?', 'Litigation is by instruction. We will tell you if it is better with counsel.')],
      testis: [quote('Rachel Green', 'Sold and bought in one chain. They told us the ugly bits early.', 'Conveyancing'), quote('Omar Ali', 'Will and LPA in one afternoon. No theatre.', 'Private client'), quote('Nina Cole', 'A neighbour dispute that could have gone nuclear. They kept it civil and cheap.', 'Dispute')],
      price: [price('🏠', 'Conveyancing', 'from £895', 'Plus searches', 'Popular'), price('📜', 'Will', 'from £240', 'Single, simple estate', ''), price('👨‍👩‍👧', 'Advice hour', '£220', 'First meeting credited if you instruct', '')],
      cta: { title: 'Talk to a solicitor this week', text: 'Send the papers — we will tell you if we are the right firm.' },
      gal: ['Meeting room', 'File notes', 'Portal screenshot', 'Signing', 'Office front', 'Team']
    }),
  pack('dentist', 'Dental Practice', 'beauty',
    ['dentist', 'dental', 'teeth', 'invisalign', 'hygienist', 'private dentist'],
    'dentistry', 'modern dental surgery', 'dentist with patient', 'bright dental clinic', {
      t: ['{brand} — calm dentistry, honest plans, and a hygienist who does not lecture.', 'Private dental care that still feels human. {brand}.', 'Check-ups, whitening and Invisalign without the hard sell. {brand}.'],
      about: '{brand} is a private dental practice built around longer appointments and a treatment plan you can actually read. We photograph as we go, show you the options, and will not start work you have not agreed.',
      aboutTitle: 'See it before we drill',
      feat: [feat('🦷', 'Longer appointments', 'Time to explain, not to rush.'), feat('📸', 'Photos as we go', 'You see what we see.'), feat('😁', 'Invisalign & whitening', 'Cosmetic work with a real plan.'), feat('😌', 'Anxiety welcome', 'Tell us. We will go slower.')],
      stats: [{ title: 'Patients', text: '3,200' }, { title: 'Rated', text: '4.9★' }, { title: 'Hygienist', text: 'On site' }, { title: 'Same-week', text: 'Emergencies' }],
      faqs: [faq('Are you taking NHS?', 'We are private. We will be honest about cost before you sit down.'), faq('Do you see children?', 'Yes — family books are welcome.'), faq('Can I come only for a hygienist?', 'Yes. Direct access hygienist appointments are listed online.'), faq('Do you offer 0% finance?', 'On plans over £500, subject to status.')],
      testis: [quote('Sophie Lane', 'First dentist I have not dreaded. They showed me the photo and the options.', 'New patient'), quote('Ben Ortiz', 'Invisalign on time, no surprises on the invoice.', 'Aligners'), quote('Karen White', 'Emergency slot the same morning. Saved the weekend.', 'Emergency')],
      price: [price('🔍', 'Exam & x-ray', '£75', 'New patient', ''), price('✨', 'Hygiene', '£85', '45 minutes', 'Popular'), price('😁', 'Whitening', 'from £350', 'Home trays', '')],
      cta: { title: 'Book the check-up you have been putting off', text: 'New patients seen this week — plans in writing, always.' },
      gal: ['Surgery', 'Hygienist', 'Before/after smile', 'Waiting room', 'Invisalign', 'Team']
    }),
  pack('accountant', 'Accountant', 'generic',
    ['accountant', 'accountants', 'bookkeeping', 'tax return', 'self assessment', 'payroll', 'vat'],
    'accountancy', 'accountant at a laptop', 'accounts office', 'spreadsheets and coffee', {
      t: ['{brand} — books that make sense, tax that is filed, and a WhatsApp when HMRC writes.', 'Stop dreading January. {brand} already did the numbers.', 'Bookkeeping, payroll and advice from people who answer. {brand}.'],
      about: '{brand} is a practice of chartered accountants for freelancers and small limited companies. We keep the books monthly, file on time, and explain the tax bill in one paragraph, not a 40-page PDF.',
      aboutTitle: 'Numbers, then a sentence',
      feat: [feat('📊', 'Monthly books', 'Not a shoebox in March.'), feat('📱', 'HMRC pings', 'We see the letter first.'), feat('💷', 'Tax in English', 'What you owe and why.'), feat('👥', 'Payroll', 'RTI on time, pensions included.')],
      stats: [{ title: 'Clients', text: '420' }, { title: 'On-time filings', text: '99%' }, { title: 'Rated', text: '4.8★' }, { title: 'Reply', text: 'Same day' }],
      faqs: [faq('Do you do self-assessment only?', 'Yes, and limited companies, and the messy bit in between.'), faq('Xero or FreeAgent?', 'Either. We will not make you switch for sport.'), faq('When do you need my records?', 'Monthly is cheapest. Year-end-only is possible and more expensive.'), faq('Can you talk to my bank?', 'With authority, yes — especially for lending packs.')],
      testis: [quote('Chris Moon', 'First accountant who explained my VAT in a voice note.', 'Ltd'), quote('Amelia Frost', 'Self-assessment filed in November. January was a holiday.', 'Sole trader'), quote('Luis Grant', 'Payroll and pensions without a spreadsheet war.', 'Employer')],
      price: [price('👤', 'Self-assessment', 'from £180', 'Uncomplicated', ''), price('🏢', 'Ltd monthly', 'from £95/mo', 'Books + VAT', 'Popular'), price('💼', 'Payroll', 'from £25/mo', 'Per company', '')],
      cta: { title: 'Send last year’s chaos', text: 'We will tell you if it is a tidy-up or a rebuild — before you instruct.' },
      gal: ['Monthly pack', 'Xero dashboard', 'Team', 'Filing confirmation', 'Coffee and ledgers', 'Client call']
    }),
  pack('tutor', 'Private Tutor', 'edu',
    ['tutor', 'tutoring', '11 plus', 'gcse tutor', 'a-level', 'maths tutor', 'english tutor'],
    'tutoring', 'tutor and student at a desk', 'study room', 'exam papers', {
      t: ['{brand} — 11+, GCSE and A-level tutoring that follows the mark scheme, not a generic worksheet.', 'Better grades from a tutor who has actually marked the paper. {brand}.', 'One-to-one tutoring, honest targets, weekly feedback. {brand}.'],
      about: '{brand} is a small tutoring practice run by teachers who still mark papers. Sessions are 55 minutes, parents get a note the same evening, and we will say if tutoring is not the right spend.',
      aboutTitle: 'Teachers, not script-readers',
      feat: [feat('📝', 'Mark-scheme first', 'We teach how the paper is marked.'), feat('📅', 'Weekly notes', 'Parents see what moved.'), feat('🎯', 'Honest targets', 'We will not sell 20 extra grades.'), feat('💻', 'Online or kitchen table', 'Same tutor either way.')],
      stats: [{ title: 'Students', text: '90' }, { title: 'Subjects', text: '8' }, { title: 'Rated', text: '4.9★' }, { title: 'Session', text: '55 min' }],
      faqs: [faq('Do you guarantee a grade?', 'No. We guarantee a plan and feedback. Anyone who guarantees grades is selling.'), faq('11+ — which boards?', 'We will ask the school list first. CEM and GL are not the same.'), faq('Group or 1:1?', 'Mostly 1:1. Pairs only when it helps.'), faq('Do you set homework?', 'Short, specific, marked. Not a booklet dump.')],
      testis: [quote('Parent of Year 10', 'Maths went from a 4 to a 6 without tears. The notes after each session were the difference.', 'GCSE'), quote('Sixth-former', 'She had marked my paper style before. That is not a worksheet tutor.', 'A-level'), quote('Year 5 parent', '11+ prep that did not take over the house.', '11+')],
      price: [price('📚', '1:1 hour', '£42–58', 'By stage', 'Popular'), price('👥', 'Pair', '£28 pp', 'When it helps', ''), price('📦', '8-week block', 'save 10%', 'Paid up front', '')],
      cta: { title: 'Book a trial session', text: 'One hour, a real plan, and a note the same evening — then you decide.' },
      gal: ['Kitchen table session', 'Marked paper', 'Weekly note', 'Online call', 'Revision card', 'Progress chart']
    }),
  pack('estateagent', 'Estate Agent', 'home',
    ['estate agent', 'estate agency', 'letting agent', 'property for sale', 'houses for sale', 'lettings'],
    'property', 'for sale board on a street', 'estate agent with keys', 'bright living room listing', {
      t: ['{brand} — local listings, honest viewings, and a solicitor-ready pack from day one.', 'Sell or let without the fog. {brand}.', 'Independent estate agency that actually knows the street. {brand}.'],
      about: '{brand} is an independent agency. We photograph properly, price from solds not wishful thinking, and keep the chain updates in writing. No fake bidding, no mystery “other interest” unless it is real.',
      aboutTitle: 'The street, not the script',
      feat: [feat('📍', 'Local solds', 'Pricing from what actually sold.'), feat('📷', 'Proper photos', 'Twilight and floorplans included.'), feat('📑', 'Solicitor pack', 'Ready before you accept.'), feat('🔑', 'Lettings too', 'Ast and inventories without a second firm.')],
      stats: [{ title: 'Sold last yr', text: '140' }, { title: 'Avg days', text: '28' }, { title: 'Rated', text: '4.8★' }, { title: 'Let stock', text: '90' }],
      faqs: [faq('What is your fee?', 'A simple percentage, agreed in writing. No “marketing pack” extras unless you want them.'), faq('Do you do online-only?', 'We do the photos and Rightmove. Viewings are still a person.'), faq('Can you value without a visit?', 'A ballpark from solds, yes. A true valuation needs the house.'), faq('Tenants — referencing?', 'Yes, and we will not skip it to fill a void.')],
      testis: [quote('The Harpers', 'Priced below the last agent’s fantasy. Sold in 11 days.', 'Vendors'), quote('New tenant', 'Inventory was boring and complete. That is a compliment.', 'Lettings'), quote('First-time buyer', 'They told us the survey risk before we offered. Kept us in the deal.', 'Buyers')],
      price: [price('🏷️', 'Sales', '1% + VAT', 'No sale, no fee', 'Popular'), price('🔑', 'Fully managed', '8% + VAT', 'Lettings', ''), price('📷', 'Valuation', 'Free', 'No obligation', '')],
      cta: { title: 'Book a valuation this week', text: 'A real number from solds on your street — not a pitch.' },
      gal: ['For sale board', 'Floorplan', 'Twilight shot', 'Keys', 'Office', 'Sold sticker']
    }),
  pack('landscaper', 'Landscaper', 'home',
    ['landscaper', 'landscaping', 'garden design', 'patio', 'driveway', 'garden builder'],
    'landscaping', 'new patio garden', 'landscaper laying stone', 'finished garden at dusk', {
      t: ['{brand} — gardens built to drain, last, and look like you meant them.', 'Patios, planting and driveways without the cowboy stories. {brand}.', 'Design on paper, build on time. {brand} landscaping.'],
      about: '{brand} designs and builds gardens. We set levels so water goes somewhere, use materials we can still buy in five years, and give a programme you can show the neighbours.',
      aboutTitle: 'Built to drain',
      feat: [feat('📐', 'Levels first', 'Water has a plan.'), feat('🧱', 'Materials that last', 'No mystery packs from a van.'), feat('📅', 'A programme', 'Start and finish dates you can diary.'), feat('🌿', 'Planting that fits', 'Not a catalogue dump.')],
      stats: [{ title: 'Gardens / yr', text: '45' }, { title: 'Rated', text: '4.9★' }, { title: 'Warranty', text: '2 yr' }, { title: 'Drawings', text: 'Included' }],
      faqs: [faq('Do you design only?', 'We design and build. Design-only is possible if you have a contractor you trust.'), faq('Planning?', 'We will flag it. Decking height and front gardens have rules.'), faq('Winter work?', 'Groundworks yes, planting when the ground allows.'), faq('Can I keep my tree?', 'We will fight for it if it is healthy. We will also say when it has to go.')],
      testis: [quote('The Nortons', 'Patio that does not pond. First time in 15 years.', 'Patio'), quote('Jules Hart', 'Drawing looked like the garden. That never happens.', 'Full redesign'), quote('Sam Okeke', 'Driveway done in the week they said. Neighbours still talking about the edge.', 'Drive')],
      price: [price('📝', 'Design visit', '£180', 'Credited if we build', ''), price('🧱', 'Patio', 'from £4,800', 'Typical 30m²', 'Popular'), price('🚗', 'Driveway', 'quoted', 'By m² and material', '')],
      cta: { title: 'Send a photo of the garden', text: 'We will tell you if it is a weekend job or a proper project.' },
      gal: ['Before mud', 'Patio night', 'Planting', 'Driveway edge', 'Levels', 'Family on the new steps']
    }),
  pack('vet', 'Veterinary Practice', 'generic',
    ['vet', 'veterinary', 'animal hospital', 'pet clinic', 'small animal vet'],
    'veterinary care', 'vet examining a dog', 'vet clinic reception', 'cat in a carrier at clinic', {
      t: ['{brand} — small-animal vets who explain the options, including the cheaper honest one.', 'Same-day sick pets, calm consults. {brand}.', 'Veterinary care without the hard upsell. {brand}.'],
      about: '{brand} is a small-animal practice. We keep consults long enough to examine the animal and the owner’s budget. Estimates are written. Out-of-hours is a named hospital, not a surprise.',
      aboutTitle: 'The animal, then the invoice',
      feat: [feat('🐾', 'Same-day sick slots', 'Not next Thursday.'), feat('💷', 'Written estimates', 'Before we proceed.'), feat('🌙', 'Named out-of-hours', 'You know where to go at 2am.'), feat('🩺', 'Nurses who know the file', 'Not a different face every jab.')],
      stats: [{ title: 'Patients', text: '5,000' }, { title: 'Rated', text: '4.8★' }, { title: 'Consult', text: '15–20 min' }, { title: 'OOH', text: 'Partner hospital' }],
      faqs: [faq('Do you see rabbits and exotics?', 'Rabbits and guinea pigs yes. Snakes — we will refer.'), faq('Are you a charity clinic?', 'No — we are private. We will talk about PDSA/RSPCA routes if money is the blocker.'), faq('Repeat prescriptions?', '48 hours, via the app or a call.'), faq('Do you do cremation?', 'Yes, with a local pet crematorium we have visited.')],
      testis: [quote('Dog owner', 'They offered the expensive scan and the wait-and-see. We chose wait-and-see. Dog is fine.', 'Consult'), quote('Cat owner', 'Nurse remembered his name. That should not feel rare.', 'Vaccine'), quote('Rabbit owner', 'They actually know lagomorphs. Referred only when it was surgical.', 'Exotics')],
      price: [price('🩺', 'Consult', '£52', 'Daytime', 'Popular'), price('💉', 'Vaccine course', 'from £80', 'By species', ''), price('🌙', 'OOH', 'Hospital fees', 'Passed through', '')],
      cta: { title: 'Register before you need us', text: 'New clients welcome — sick pets seen the same day when we can.' },
      gal: ['Consult room', 'Waiting cats', 'Nurse station', 'Pharmacy', 'Garden for dogs', 'Team']
    }),
  pack('physio', 'Physiotherapy Clinic', 'fitness',
    ['physio', 'physiotherapy', 'physiotherapist', 'sports injury', 'rehab', 'back pain clinic'],
    'physiotherapy', 'physio treating a shoulder', 'rehab clinic', 'exercise rehab', {
      t: ['{brand} — diagnosis first, then a plan you can do at home, not a 12-week upsell.', 'Backs, knees and sports injuries treated like adults. {brand}.', 'Physio that explains what is going on. {brand}.'],
      about: '{brand} is a physiotherapy clinic. The first session is assessment, not a sales funnel. You leave with a written plan and a number of sessions we actually believe in.',
      aboutTitle: 'A plan, not a package',
      feat: [feat('🧠', 'Diagnosis first', 'We will say if it is not physio.'), feat('🏠', 'Home programme', 'Exercises you will actually do.'), feat('⚽', 'Sports rehab', 'Return-to-play criteria, not vibes.'), feat('📅', 'Follow-up that fits', 'We discharge you on purpose.')],
      stats: [{ title: 'Patients / wk', text: '110' }, { title: 'Rated', text: '4.9★' }, { title: 'First session', text: '45 min' }, { title: 'HCPC', text: 'Registered' }],
      faqs: [faq('Do I need a GP letter?', 'No for private. Insurers sometimes want one — we will check.'), faq('Can you see NHS referrals?', 'Not at this clinic. We can write to your GP.'), faq('Do you do scans?', 'We refer. We do not sell you an MRI to look busy.'), faq('Parking?', 'Two spaces and a bus stop. Details on the confirmation.')],
      testis: [quote('Runner', 'They stopped me buying another pair of shoes and fixed the hip. Off the waiting list energy.', 'Running'), quote('Office back', 'Four sessions, then homework. My old physio wanted twelve.', 'Spine'), quote('Netball', 'Clear return-to-play tests. Coach actually trusted it.', 'Sport')],
      price: [price('🔍', 'Assessment', '£65', '45 minutes', 'Popular'), price('🔁', 'Follow-up', '£48', '30 minutes', ''), price('📦', 'Block of 6', '£270', 'If we both agree', '')],
      cta: { title: 'Book the assessment', text: 'Leave with a diagnosis and a plan — not a package you did not ask for.' },
      gal: ['Treatment bench', 'Rehab space', 'Home sheet', 'Tape and needles', 'Waiting', 'Team']
    }),
  pack('nursery', 'Nursery & Childcare', 'edu',
    ['nursery', 'childcare', 'preschool', 'day nursery', 'ofsted nursery', 'toddler room'],
    'childcare', 'children playing at nursery', 'nursery garden', 'story time at preschool', {
      t: ['{brand} — Ofsted-registered childcare with a garden, a named key person, and photos you actually get.', 'A nursery that feels like a village, not a warehouse. {brand}.', 'Settling-in that respects the child. {brand}.'],
      about: '{brand} is an Ofsted-registered nursery. Every child has a key person, the garden is used in weather that is merely annoying, and we send photos because you are at work wondering.',
      aboutTitle: 'A key person, not a rota',
      feat: [feat('👩‍🍼', 'Named key person', 'Someone who knows your child.'), feat('🌳', 'Garden every day', 'Coats exist for a reason.'), feat('📷', 'Photos to your phone', 'Not a monthly PDF.'), feat('📋', 'Ofsted', 'Come and read the last report.')],
      stats: [{ title: 'Places', text: '52' }, { title: 'Ofsted', text: 'Good' }, { title: 'Garden', text: 'Daily' }, { title: 'Ratio', text: 'Met' }],
      faqs: [faq('Do you take 15/30 hours?', 'Yes, with a clear paid-hours wraparound so there are no surprises.'), faq('Allergies?', 'Kitchen is nut-aware. Care plans are on the wall and in the app.'), faq('Settling in?', 'Paid settling sessions, as many as the child needs, not a one-morning dump.'), faq('Late pickup?', 'A fee, because the staff have children too. We will still be kind.')],
      testis: [quote('Parent of two', 'They told us our son was not ready for the big room. That honesty is why we stayed.', 'Toddler'), quote('Shift-worker', 'Opening hours that match real jobs. Not 9–3 and a prayer.', 'Full day'), quote('First child', 'Settling took a week. They never made us feel difficult.', 'Baby')],
      price: [price('👶', 'Full day', 'from £68', 'Under 2s higher', ''), price('🕓', 'Morning', 'from £42', '8–1', 'Popular'), price('🎫', 'Funded hours', 'see pack', '15/30 + wraparound', '')],
      cta: { title: 'Come for a look round', text: 'No hard sell — meet the key person and see the garden in the rain.' },
      gal: ['Garden', 'Story corner', 'Snack', 'Baby room', 'Mud kitchen', 'Pickup smiles']
    }),
  pack('pub', 'Independent Pub', 'food',
    ['independent pub', 'local pub', 'gastropub', 'pub with rooms', 'ale house', 'pub'],
    'the pub', 'cosy pub interior', 'pints on a bar', 'pub garden picnic tables', {
      t: ['{brand} — cask that is kept, a kitchen that is open, and a fire that is actually lit.', 'Your local, run like you would run it. {brand}.', 'Pints, pies and a garden that works in October. {brand}.'],
      about: '{brand} is an independent pub. We keep cask properly, the kitchen uses a short seasonal menu, and dogs are welcome until the evening service gets busy. Quiz night is Thursday and the questions are not from a PDF.',
      aboutTitle: 'Kept beer, short menu',
      feat: [feat('🍺', 'Cask kept right', 'Stillaged, not theatre.'), feat('🥧', 'Kitchen open', 'Short menu, real gravy.'), feat('🔥', 'Fire lit', 'When it is cold, not for Instagram.'), feat('🐕', 'Dogs until 7', 'Water bowls, then we pack them off.')],
      stats: [{ title: 'Ales on', text: '6' }, { title: 'Garden', text: '80 covers' }, { title: 'Quiz', text: 'Thu' }, { title: 'Rated', text: '4.7★' }],
      faqs: [faq('Do you take bookings?', 'Sundays and Friday nights yes. Tuesdays, just walk in.'), faq('Kids?', 'Until 8pm, if they can sit like humans.'), faq('Rooms?', 'Three rooms above the bar. Breakfast is the full one.'), faq('Is it a sports pub?', 'Six Nations and the odd final. Not 12 screens.')],
      testis: [quote('Regular', 'They changed the ale and told us why. That is a proper pub.', 'Cask'), quote('Sunday roast', 'Yorkshires the size of a hat. Booked for the rest of the month.', 'Kitchen'), quote('Dog walker', 'Water, a biscuit, and they asked the dog’s name. We are ruined for other pubs.', 'Garden')],
      price: [price('🍺', 'Pint', 'from £4.60', 'Cask', ''), price('🥧', 'Pie & pint', '£16', 'Weekday lunch', 'Popular'), price('🛏️', 'Room', 'from £110', 'B&B', '')],
      cta: { title: 'See what’s on the bar tonight', text: 'Walk in — or book Sunday before the roast goes.' },
      gal: ['Bar', 'Fire', 'Garden', 'Roast', 'Cask stillage', 'Quiz night'],
      menu: {
        title: 'On the board', subtitle: 'Short, seasonal, gone when it’s gone.',
        cols: ['Plate', 'Notes', 'Price'],
        rows: [['Pie of the day', 'Gravy, mash, greens', '£16'], ['Fish & chips', 'Mushy peas, tartare', '£17'], ['Ploughman’s', 'Cheddar, pickles, bread', '£13'], ['Sunday roast', 'One sitting, book it', '£19']]
      }
    }),
  pack('winebar', 'Wine Bar', 'food',
    ['wine bar', 'winebar', 'natural wine', 'enoteca', 'wine shop bar'],
    'wine', 'wine bar small plates', 'bottles on shelves', 'natural wine pour', {
      t: ['{brand} — natural and classic bottles, small plates, and staff who pour a taste without a lecture.', 'A wine bar for people who drink, not collect. {brand}.', 'By the glass, by the bottle, by the evening. {brand}.'],
      about: '{brand} is a wine bar with a short list that actually turns over. We taste with you, we will say if a bottle is funky, and the kitchen does small plates that do not fight the wine.',
      aboutTitle: 'A list that moves',
      feat: [feat('🍷', 'By the glass', 'Twelve, not two house reds.'), feat('🧀', 'Small plates', 'Built for bottles, not burgers.'), feat('📚', 'No lecture', 'A taste, then you decide.'), feat('🛍️', 'Retail prices', 'Take the bottle home.')],
      stats: [{ title: 'By the glass', text: '12' }, { title: 'List', text: '~90' }, { title: 'Rated', text: '4.8★' }, { title: 'Kitchen', text: 'Wed–Sat' }],
      faqs: [faq('Natural only?', 'Mostly, plus a few classics so your uncle is not stranded.'), faq('Walk-ins?', 'Bar yes, tables Friday/Saturday — book.'), faq('Corkage?', '£10 if you bought it here last week. Otherwise ask.'), faq('Sober drinks?', 'Low-abv and a proper non-alc list. Not an afterthought.')],
      testis: [quote('Date night', 'They poured three tastes and never once said terroir at us.', 'Bar'), quote('Takeaway bottle', 'Paid bar price minus the glass. That is how it should work.', 'Retail'), quote('Group of six', 'Small plates arrived as the bottles did. No traffic jam.', 'Table')],
      price: [price('🥂', 'Glass', 'from £7', '125ml', ''), price('🍾', 'Bottle in', 'from £28', 'Bar markup is kind', 'Popular'), price('🥖', 'Plates', '£8–14', 'Share them', '')],
      cta: { title: 'Come for a glass, leave with a bottle', text: 'Walk in at the bar — tables at the weekend want a booking.' },
      gal: ['Back bar', 'By the glass', 'Small plates', 'Shop shelf', 'Terrace', 'Pour'],
      menu: {
        title: 'By the glass tonight', subtitle: 'Changes when the bottle ends.',
        cols: ['Wine', 'Glass', 'Bottle'],
        rows: [['Skin-contact Riesling', '£8', '£38'], ['Beaujolais villages', '£7.5', '£34'], ['Etna rosso', '£9', '£44'], ['Pet-nat', '£8.5', '£40']]
      }
    }),
  pack('hotel', 'Independent Hotel', 'travel',
    ['hotel', 'boutique hotel', 'independent hotel', 'guest house', 'b&b', 'bed and breakfast', 'rooms'],
    'hotel stay', 'boutique hotel bedroom', 'hotel breakfast', 'hotel reception', {
      t: ['{brand} — rooms with proper beds, breakfast that is cooked, and a stay that is not a chain script.', 'A small hotel run by people who sleep here too. {brand}.', 'Independent rooms, real keys, late breakfast. {brand}.'],
      about: '{brand} is a small independent hotel. Beds are as good as we could buy, breakfast is cooked to order, and we will tell you which restaurant to skip. Check-in is a person.',
      aboutTitle: 'A key, not an app',
      feat: [feat('🛏️', 'Proper beds', 'We slept on them first.'), feat('🍳', 'Breakfast cooked', 'Not a sad buffet island.'), feat('🗺️', 'Local notes', 'Where to eat, honestly.'), feat('🤫', 'Quiet rooms', 'The street ones are cheaper and we say so.')],
      stats: [{ title: 'Rooms', text: '12' }, { title: 'Rated', text: '4.8★' }, { title: 'Breakfast', text: 'Until 10:30' }, { title: 'Walk to centre', text: '6 min' }],
      faqs: [faq('Parking?', 'Two spaces, first come. The car park is 4 minutes and we will send the code.'), faq('Children?', 'Yes. Cots are free. The duplex is the one you want.'), faq('Pets?', 'Two rooms. Say so when you book.'), faq('Late check-in?', 'Yes — we will text a code if we have gone to bed.')],
      testis: [quote('Weekend stay', 'Beds better than the four-star down the road. Breakfast was an event.', 'Leisure'), quote('Work trip', 'Desk, kettle, silence. That is all I needed.', 'Midweek'), quote('Anniversary', 'They put a bottle in the room without making a speech.', 'Treat')],
      price: [price('🌙', 'Room', 'from £140', 'B&B', 'Popular'), price('🏡', 'Duplex', 'from £210', 'Family', ''), price('⏱️', 'Day let', 'ask', 'Rare', '')],
      cta: { title: 'See the rooms before the OTAs', text: 'Book direct — the rate is kinder and we know your name.' },
      gal: ['Bedroom', 'Breakfast', 'Staircase', 'Street', 'Bathroom', 'Garden table']
    }),
  pack('garage', 'Independent Garage', 'auto',
    ['mot garage', 'car garage', 'independent garage', 'mot centre', 'car service', 'mechanic', 'vehicle repair', 'garage'],
    'car repair', 'mechanic under a bonnet', 'independent garage workshop', 'serviced car keys', {
      t: ['{brand} — MOTs, servicing and repairs with a photo of the part before we fit it.', 'An independent garage that explains the bill. {brand}.', 'Service, MOT, and the honest “you can wait on that”. {brand}.'],
      about: '{brand} is an independent garage. We photograph worn parts, call before we exceed the quote, and will tell you when something can wait until the next service.',
      aboutTitle: 'A photo before the invoice',
      feat: [feat('📷', 'Parts on camera', 'See it before we fit it.'), feat('💷', 'Call before extras', 'No surprise totals.'), feat('🔧', 'OEM or quality pattern', 'You choose, we advise.'), feat('📅', 'MOT + service', 'Same day when we can.')],
      stats: [{ title: 'MOTs / wk', text: '40' }, { title: 'Rated', text: '4.9★' }, { title: 'Wait-and-see', text: 'We offer it' }, { title: 'Courtesy', text: '2 cars' }],
      faqs: [faq('Can I wait?', 'For MOTs yes. For a clutch, no — we will give you a courtesy car if we have one.'), faq('Main dealer vs you?', 'We use OEM or equivalent. Warranties stay intact on servicing in the UK.'), faq('EV?', 'Servicing and tyres yes. High-voltage repairs we refer.'), faq('Do you collect?', 'Within 5 miles, booked the day before.')],
      testis: [quote('Fiesta owner', 'They sent a photo of the pad and said it could wait 2,000 miles. I nearly sent a hamper.', 'Brakes'), quote('Fleet', 'Three vans, one invoice, no theatre.', 'Commercial'), quote('MOT fail', 'Fixed the lamp, retest free, out in an hour.', 'MOT')],
      price: [price('✅', 'MOT', '£54.85', 'Class 4', ''), price('🛠️', 'Interim service', 'from £149', 'Oil + checks', 'Popular'), price('📞', 'Diagnostic', '£60', 'Credited if we fix', '')],
      cta: { title: 'Book the MOT before it runs out', text: 'Send the reg — we will tell you what is due and what can wait.' },
      gal: ['Ramp', 'Photo of pads', 'Courtesy car', 'MOT bay', 'Keys board', 'Team']
    }),
  pack('tattoo', 'Tattoo Studio', 'beauty',
    ['tattoo studio', 'tattoo shop', 'tattooist', 'custom tattoo', 'tattoo'],
    'tattoo', 'tattoo artist at work', 'tattoo studio interior', 'healed tattoo detail', {
      t: ['{brand} — custom tattoos, proper aftercare, and artists who will refuse a bad idea.', 'A studio, not a flash-on-the-wall factory. {brand}.', 'Consult first, stencil next, tattoo when it is right. {brand}.'],
      about: '{brand} is a custom tattoo studio. We consult before we book a big piece, we will redraw until it sits on the body, and we would rather lose a deposit than tattoo something we will both hate in two years.',
      aboutTitle: 'Draw it until it sits',
      feat: [feat('✏️', 'Custom first', 'Flash is the exception.'), feat('🧼', 'Licensed studio', 'Autoclave, not folklore.'), feat('🩹', 'Aftercare that is written', 'And a check if it looks angry.'), feat('🙅', 'We will say no', 'Hands, faces, and drunk ideas.')],
      stats: [{ title: 'Artists', text: '4' }, { title: 'Rated', text: '4.9★' }, { title: 'Consult', text: 'Free' }, { title: 'Healed photos', text: 'On the wall' }],
      faqs: [faq('Walk-ins?', 'Small flash Fridays. Everything else is booked.'), faq('Age?', '18+ with ID. No exceptions.'), faq('Touch-ups?', 'Free within 6 months if you followed aftercare.'), faq('Cover-ups?', 'Consult. Some things need a laser first and we will say so.')],
      testis: [quote('First tattoo', 'They talked me out of a quote on my ribs. Got a better piece on my arm. Grateful.', 'Custom'), quote('Sleeve', 'Three sessions, stencil every time, healed like they promised.', 'Project'), quote('Cover-up', 'Honest that it needed laser. Did the tattoo after. Looks like a plan, not a patch.', 'Cover')],
      price: [price('⏱️', 'Day rate', 'from £450', 'By artist', 'Popular'), price('✨', 'Small', 'from £120', 'Flash Friday', ''), price('💬', 'Consult', 'Free', 'Big pieces', '')],
      cta: { title: 'Send the idea, not a Pinterest dump', text: 'Consult is free — we will tell you if it belongs on skin.' },
      gal: ['Studio', 'Stencil', 'Healed piece', 'Autoclave', 'Drawings', 'Artist at work']
    }),
  pack('architect', 'Architecture Studio', 'home',
    ['architect', 'architecture practice', 'architectural design', 'planning application', 'extension architect'],
    'architecture', 'architect drawings on a table', 'home extension', 'architecture model', {
      t: ['{brand} — houses extended and reworked with drawings that planners can read and builders can price.', 'Architecture that survives contact with building control. {brand}.', 'From measured survey to site, without disappearing. {brand}.'],
      about: '{brand} is a small architecture practice for houses and small commercial. We measure twice, submit planning that anticipates the officer’s mood, and stay on site so the builder is not guessing our drawings.',
      aboutTitle: 'Drawings that get built',
      feat: [feat('📏', 'Measured survey', 'We start with the house that exists.'), feat('📑', 'Planning that lands', 'We have met the officers.'), feat('🧱', 'Site queries', 'We answer the builder.'), feat('💷', 'Cost in the room', 'Pretty that cannot be priced is not a design.')],
      stats: [{ title: 'Projects / yr', text: '22' }, { title: 'Planning', text: 'Most first time' }, { title: 'RIBA', text: 'Chartered' }, { title: 'Rated', text: '4.8★' }],
      faqs: [faq('Permitted development?', 'We will tell you if you do not need us. That is a good day.'), faq('Do you tender?', 'Yes — a proper pack, not a sketch on a napkin.'), faq('Interior only?', 'We can. Structure still gets an engineer.'), faq('Fees?', 'Percentage or staged lump sums. Both in writing.')],
      testis: [quote('Side-return', 'Planning in eight weeks. Builder said the pack was the clearest he had seen.', 'Extension'), quote('Listed cottage', 'They liked the house. That is rarer than it should be.', 'Listed'), quote('Self-build', 'Stayed for site queries. Saved two expensive mistakes.', 'New build')],
      price: [price('📐', 'Feasibility', 'from £1,200', 'Drawings + options', ''), price('📑', 'Planning pack', 'quoted', 'By size', 'Popular'), price('🏗️', 'Technical design', 'quoted', 'For tender', '')],
      cta: { title: 'Send the floorplan and a photo', text: 'We will tell you if it is PD, planning, or a conversation about moving.' },
      gal: ['Model', 'Site', 'Section drawing', 'Finished extension', 'Mood board', 'Team']
    }),
  pack('locksmith', 'Locksmith', 'home',
    ['locksmith', 'locked out', 'uPVC lock', 'british standard locks', 'emergency locksmith'],
    'locksmith', 'locksmith at a front door', 'locksmith van at night', 'new British Standard lock', {
      t: ['{brand} — 30-minute lockouts, British Standard locks, and a price before we drill.', 'Locked out at 1am should not be a ransom. {brand}.', 'uPVC, mortice, autos. {brand} locksmiths.'],
      about: '{brand} is a locksmith who quotes before drilling. Most uPVC lockouts open without destroying the barrel. We fit BS3621 where insurers care, and we show ID because anyone can buy a van sign.',
      aboutTitle: 'Open first, drill last',
      feat: [feat('⏱️', '30-minute target', 'Urban call-outs, nights included.'), feat('💷', 'Price before drill', 'No ransom at the door.'), feat('🔒', 'BS locks', 'The ones insurers recognise.'), feat('🪪', 'ID on the step', 'Ask for it.')],
      stats: [{ title: 'Lockouts / wk', text: '50+' }, { title: 'No-drill', text: 'Most uPVC' }, { title: 'Rated', text: '4.9★' }, { title: 'Night', text: 'Covered' }],
      faqs: [faq('Will you damage the door?', 'uPVC usually no. Wooden mortice sometimes. We say before we start.'), faq('Car keys?', 'Some vehicles. We will tell you if you need the dealer.'), faq('Can you change locks after a break-in?', 'Same day, and we will photograph for the insurance.'), faq('Are you police-recommended?', 'We are DBS-checked and will show ID. Be wary of anyone who will not.')],
      testis: [quote('Locked out', '1am, quoted on the phone, in without drilling. Paid what they said.', 'Night'), quote('Landlord', 'Six cylinders in an afternoon after a tenant left with the keys.', 'Lettings'), quote('Insurance job', 'BS locks, invoice the next morning, claim went through.', 'Claim')],
      price: [price('🚪', 'Lockout', 'from £79', 'Daytime uPVC', 'Popular'), price('🌙', 'Night', 'from £129', 'Before 7am', ''), price('🔒', 'BS cylinder', 'from £90', 'Supply and fit', '')],
      cta: { title: 'Call while you are still on the step', text: 'A price, an ETA, and ID when we arrive.' },
      gal: ['Night van', 'New cylinder', 'ID badge', 'uPVC door', 'Key cutting', 'After a lockout']
    }),
  pack('catering', 'Event Catering', 'events',
    ['catering', 'event catering', 'wedding catering', 'private chef', 'outside catering', 'buffet catering', 'caterer'],
    'catering', 'catering service at an event', 'canapes on a tray', 'wedding catering table', {
      t: ['{brand} — event catering that tastes like a kitchen, not a holding pen.', 'Weddings, offices and backyard parties, cooked properly. {brand}.', 'A menu you can eat, a timeline that holds. {brand} catering.'],
      about: '{brand} caters weddings and private events from a real kitchen. We taste the menu with you, staff the room properly, and would rather do fewer events than send out lukewarm chicken.',
      aboutTitle: 'Cooked, not held',
      feat: [feat('🍽️', 'Tasting included', 'On booked weddings.'), feat('👩‍🍳', 'Chefs on site', 'Not a reheat van only.'), feat('📋', 'Dietary is a system', 'Not a handshake.'), feat('⏰', 'Service on the minute', 'Speeches, then food.')],
      stats: [{ title: 'Events / yr', text: '90' }, { title: 'Rated', text: '4.9★' }, { title: 'Guest max', text: '180' }, { title: 'Tastings', text: 'Included' }],
      faqs: [faq('Do you do drop-off buffets?', 'Yes, for offices. Weddings we staff.'), faq('Kitchen on site?', 'We can work from yours or bring a prep kitchen. The recce decides.'), faq('Kids’ menu?', 'Yes, and we will not just give them chips unless you ask.'), faq('Leftovers?', 'Packed for you if environmental health allows. We will say on the night.')],
      testis: [quote('Wedding couple', 'Hot food after speeches. That should not be a miracle.', 'Wedding'), quote('Office Friday', 'Drop-off that still tasted like lunch, not a petrol station.', 'Corporate'), quote('Birthday 60', 'Dietary mix of 70 people, no one was the awkward plate.', 'Private')],
      price: [price('🥗', 'Drop-off', 'from £12 pp', 'Office', ''), price('💍', 'Wedding', 'from £65 pp', 'Staffed', 'Popular'), price('🥂', 'Canapés', 'from £18 pp', 'Hour one', '')],
      cta: { title: 'Tell us the date and the headcount', text: 'If we are free, we will send a menu that can actually be cooked.' },
      gal: ['Service', 'Canapés', 'Kitchen', 'Table', 'Staff briefing', 'Pudding']
    }),
  pack('brewery', 'Independent Brewery', 'food',
    ['craft brewery', 'independent brewery', 'taproom', 'brewery tap', 'beer brewery', 'brewery'],
    'brewery', 'brewery taproom pints', 'stainless fermenters', 'brewery garden', {
      t: ['{brand} — beer brewed here, poured here, and explained only if you ask.', 'A taproom with a brewery attached, not the other way round. {brand}.', 'Fresh beer, a garden, and tours that are not a TED talk. {brand}.'],
      about: '{brand} brews on site and pours it in the taproom. The list turns over, the garden is dog-friendly, and the tour is 45 minutes of actual brewing, not a brand film.',
      aboutTitle: 'Brewed in the next room',
      feat: [feat('🍺', 'On the same site', 'What you drink was made here.'), feat('🌱', 'Garden', 'Dogs, kids, coats.'), feat('🧪', 'Fresh list', 'When the tank is empty, it is empty.'), feat('🚶', 'Tours', 'Saturdays, small groups.')],
      stats: [{ title: 'Tanks', text: '12' }, { title: 'On tap', text: '8–10' }, { title: 'Rated', text: '4.8★' }, { title: 'Tour', text: 'Sat' }],
      faqs: [faq('Can I buy poly pins?', 'Yes, 48 hours’ notice. They are fresh, not a warehouse.'), faq('Food?', 'Pizza van Friday–Sunday. Kitchens we trust, not a frozen burger.'), faq('Kids?', 'Until 7pm in the garden. No, they cannot have a half.'), faq('Merchandise?', 'A few shirts. The beer is the product.')],
      testis: [quote('Local', 'They ran out of the pale and put a sign up instead of a lie.', 'Taproom'), quote('Tour', 'I finally understand hops. Also I bought a case.', 'Saturday'), quote('Dog', 'Water bowl, shade, and they asked her name. Five stars from both of us.', 'Garden')],
      price: [price('🍺', 'Pint', 'from £4.80', 'Taproom', ''), price('📦', 'Case', 'from £32', 'Mixed', 'Popular'), price('🚶', 'Tour', '£18', 'Includes pints', '')],
      cta: { title: 'See what’s on tap this week', text: 'Walk in — tours on Saturday, pizza when the van is here.' },
      gal: ['Taproom', 'Tanks', 'Garden', 'Pint pour', 'Tour', 'Cans'],
      menu: {
        title: 'On tap', subtitle: 'When the tank is done, the beer is done.',
        cols: ['Beer', 'Style', 'ABV'],
        rows: [['House pale', 'Session pale', '4.2%'], ['Best bitter', 'Cask', '4.0%'], ['Night stout', 'Stout', '5.4%'], ['Garden pils', 'Lager', '4.6%']]
      }
    })
];

if (typeof module !== 'undefined' && module.exports) module.exports = AiNichesExtra;
